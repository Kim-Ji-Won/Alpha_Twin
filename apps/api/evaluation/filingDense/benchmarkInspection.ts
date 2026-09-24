import { Client } from 'pg';
import { BENCHMARK_IDENTITY, BenchmarkSafetyError, REQUIRED_BENCHMARK_MIGRATIONS } from './benchmarkMarkerContract.js';

export const INVENTORY_TABLES = Object.freeze({
  documents: 'filing_document', representations: 'filing_document_representation_manifest',
  chunks: 'filing_chunk', receipts: 'filing_receipt', relations: 'filing_correction_relation',
  families: 'filing_report_family', lexicalGenerations: 'filing_lexical_generation',
  eligibility: 'filing_retrieval_eligibility', activations: 'filing_retrieval_activation',
  activationHistory: 'filing_retrieval_activation_history',
});
export type BenchmarkInventory = Readonly<Record<keyof typeof INVENTORY_TABLES, number>>;

export function assertBenchmarkRuntimeIdentity(value: unknown): void {
  if (value !== BENCHMARK_IDENTITY.databaseName) throw new BenchmarkSafetyError('BENCHMARK_RUNTIME_DB_MISMATCH');
}

export async function inspectRuntimeIdentity(client: Client): Promise<void> {
  assertBenchmarkRuntimeIdentity((await client.query('SELECT current_database() AS name')).rows[0]?.name);
}

export async function beginBenchmarkReadOnly(client: Client): Promise<void> {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  if ((await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only !== 'on') {
    throw new BenchmarkSafetyError('BENCHMARK_READ_ONLY_NOT_ENFORCED');
  }
  await inspectRuntimeIdentity(client);
}

export async function inspectBenchmarkMarker(client: Client): Promise<'absent' | 'exact'> {
  const relation = (await client.query(`SELECT c.oid, c.relkind, c.relpersistence,
      c.relrowsecurity, c.relforcerowsecurity, c.relhasrules,
      EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers,
      EXISTS (SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) AS inheritance
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='benchmark_environment_marker'`)).rows[0];
  if (!relation) return 'absent';
  const invalid = () => { throw new BenchmarkSafetyError('BENCHMARK_MARKER_SCHEMA_INVALID'); };
  if (relation.relkind !== 'r' || relation.relpersistence !== 'p' || relation.relrowsecurity
    || relation.relforcerowsecurity || relation.relhasrules || relation.triggers || relation.inheritance) invalid();
  const columns = (await client.query(`SELECT a.attname, a.atttypid::integer AS type, a.attnotnull,
      a.atthasdef, a.attidentity, a.attgenerated, a.attisdropped
    FROM pg_catalog.pg_attribute a WHERE a.attrelid=$1 AND a.attnum>0 ORDER BY a.attnum`, [relation.oid])).rows;
  if (columns.length !== 3 || columns.some((c, i) => c.attname !== ['marker_id', 'purpose', 'database_name'][i]
    || c.type !== 25 || !c.attnotnull || c.atthasdef || c.attidentity || c.attgenerated || c.attisdropped)) invalid();
  const constraints = (await client.query(`SELECT conname, contype, convalidated, condeferrable,
      pg_catalog.pg_get_constraintdef(oid) AS definition
    FROM pg_catalog.pg_constraint WHERE conrelid=$1 ORDER BY conname`, [relation.oid])).rows;
  const expected: Record<string, string> = {
    benchmark_environment_marker_pkey: 'PRIMARY KEY (marker_id)',
    benchmark_marker_id_check: `CHECK ((marker_id = '${BENCHMARK_IDENTITY.markerId}'::text))`,
    benchmark_marker_purpose_check: `CHECK ((purpose = '${BENCHMARK_IDENTITY.purpose}'::text))`,
    benchmark_marker_database_check: `CHECK ((database_name = '${BENCHMARK_IDENTITY.databaseName}'::text))`,
  };
  if (constraints.length !== 4 || constraints.some(c => !c.convalidated || c.condeferrable
    || expected[c.conname] !== c.definition)) invalid();
  const rows = (await client.query(`SELECT marker_id, purpose, database_name
    FROM public.benchmark_environment_marker LIMIT 2`)).rows;
  if (rows.length === 0) throw new BenchmarkSafetyError('BENCHMARK_MARKER_MISSING');
  if (rows.length !== 1 || rows[0].marker_id !== BENCHMARK_IDENTITY.markerId
    || rows[0].purpose !== BENCHMARK_IDENTITY.purpose || rows[0].database_name !== BENCHMARK_IDENTITY.databaseName) {
    throw new BenchmarkSafetyError('BENCHMARK_MARKER_CONFLICT');
  }
  return 'exact';
}

export async function inspectBenchmarkCorpus(client: Client): Promise<{
  inventory: BenchmarkInventory; continuityFingerprint: string;
}> {
  try {
    const history = (await client.query(`SELECT c.relkind, c.relpersistence, c.relrowsecurity
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='pgmigrations'`)).rows[0];
    if (history?.relkind !== 'r' || history.relpersistence !== 'p' || history.relrowsecurity) {
      throw new BenchmarkSafetyError('BENCHMARK_SCHEMA_INCOMPLETE');
    }
    const migrations = (await client.query('SELECT name FROM public.pgmigrations ORDER BY id LIMIT 100')).rows;
    if (JSON.stringify(migrations.map(row => row.name)) !== JSON.stringify(REQUIRED_BENCHMARK_MIGRATIONS)) {
      throw new BenchmarkSafetyError('BENCHMARK_SCHEMA_INCOMPLETE');
    }
    const inventory = {} as Record<keyof typeof INVENTORY_TABLES, number>;
    const fingerprints: string[] = [];
    for (const [key, table] of Object.entries(INVENTORY_TABLES)) {
      const relation = (await client.query(`SELECT c.relkind, c.relpersistence, c.relrowsecurity
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='filing_intelligence' AND c.relname=$1`, [table])).rows[0];
      if (relation?.relkind !== 'r' || relation.relpersistence !== 'p' || relation.relrowsecurity) {
        throw new BenchmarkSafetyError('BENCHMARK_SCHEMA_INCOMPLETE');
      }
      // No document content is selected. Physical row identities detect intervening writes,
      // including same-count replacements; this is not a durable corpus identity proof.
      const row = (await client.query(`SELECT count(*)::integer AS count,
        md5(coalesce(string_agg(identity, ',' ORDER BY identity), '')) AS fingerprint
        FROM (SELECT xmin::text || ':' || ctid::text AS identity
          FROM filing_intelligence.${table} LIMIT 1000001) bounded`)).rows[0];
      if (!row || row.count > 1_000_000) throw new BenchmarkSafetyError('BENCHMARK_SCHEMA_INCOMPLETE');
      inventory[key as keyof BenchmarkInventory] = row.count;
      fingerprints.push(`${table}:${row.count}:${row.fingerprint}`);
    }
    if (Object.entries(inventory).some(([key, count]) => key !== 'relations' && count === 0)) {
      throw new BenchmarkSafetyError('BENCHMARK_EMPTY_OR_REINITIALIZED');
    }
    return { inventory: Object.freeze(inventory), continuityFingerprint: fingerprints.join('|') };
  } catch (error) {
    if (error instanceof BenchmarkSafetyError) throw error;
    throw new BenchmarkSafetyError('BENCHMARK_SCHEMA_INCOMPLETE');
  }
}
