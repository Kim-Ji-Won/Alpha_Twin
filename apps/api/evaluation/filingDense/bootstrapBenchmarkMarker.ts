import { Client } from 'pg';
import { BENCHMARK_IDENTITY, BenchmarkFailure, BenchmarkSafetyError, safeBenchmarkFailure } from './benchmarkMarkerContract.js';
import { BENCHMARK_MARKER_DDL } from './benchmarkMarkerDdl.js';
import { INVENTORY_TABLES, beginBenchmarkReadOnly, inspectBenchmarkCorpus, inspectBenchmarkMarker,
  inspectRuntimeIdentity } from './benchmarkInspection.js';
import { closeBenchmarkClient, createBenchmarkClient } from './benchmarkTargetPolicy.js';

export type BenchmarkBootstrapResult = { readonly status: 'BOOTSTRAPPED' | 'ALREADY_BOOTSTRAPPED' | BenchmarkFailure };

export async function bootstrapBenchmarkMarker(): Promise<BenchmarkBootstrapResult> {
  let client: Client | undefined;
  let preliminaryFingerprint: string | undefined;
  try {
    client = createBenchmarkClient('bootstrap');
    await client.connect();
    await beginBenchmarkReadOnly(client);
    const initialMarker = await inspectBenchmarkMarker(client);
    const before = await inspectBenchmarkCorpus(client);
    preliminaryFingerprint = before.continuityFingerprint;
    await client.query('ROLLBACK');
    if (initialMarker === 'exact') return { status: 'ALREADY_BOOTSTRAPPED' };

    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    if ((await client.query('SHOW transaction_isolation')).rows[0]?.transaction_isolation !== 'read committed') {
      throw new BenchmarkSafetyError('BOOTSTRAP_FAILED');
    }
    // READ COMMITTED gives post-lock inspections fresh snapshots even if a writer
    // commits while we wait. SHARE locks then prevent further corpus writes.
    await client.query('SELECT pg_catalog.pg_advisory_xact_lock(173528, 1)');
    await inspectRuntimeIdentity(client);
    await client.query(`LOCK TABLE public.pgmigrations, ${Object.values(INVENTORY_TABLES)
      .map(table => `filing_intelligence.${table}`).join(', ')} IN SHARE MODE`);
    const current = await inspectBenchmarkCorpus(client);
    if (current.continuityFingerprint !== before.continuityFingerprint) {
      throw new BenchmarkSafetyError('BOOTSTRAP_CORPUS_IDENTITY_INSUFFICIENT');
    }
    if (await inspectBenchmarkMarker(client) === 'exact') return { status: 'ALREADY_BOOTSTRAPPED' };
    await client.query(BENCHMARK_MARKER_DDL);
    await client.query(`INSERT INTO public.benchmark_environment_marker (marker_id, purpose, database_name)
      VALUES ($1, $2, $3)`, [BENCHMARK_IDENTITY.markerId, BENCHMARK_IDENTITY.purpose, BENCHMARK_IDENTITY.databaseName]);
    await inspectBenchmarkMarker(client);
    await client.query('COMMIT');
    return { status: 'BOOTSTRAPPED' };
  } catch (error) {
    // A non-cooperating creator may race the advisory lock. Never replace its table;
    // inspect the committed winner in a fresh read-only snapshot instead.
    if (client && preliminaryFingerprint && typeof error === 'object' && error !== null && 'code' in error
      && ['42P07', '23505', '42710'].includes(String(error.code))) {
      try {
        await client.query('ROLLBACK');
        await beginBenchmarkReadOnly(client);
        const marker = await inspectBenchmarkMarker(client);
        const current = await inspectBenchmarkCorpus(client);
        if (marker === 'exact' && current.continuityFingerprint === preliminaryFingerprint) {
          return { status: 'ALREADY_BOOTSTRAPPED' };
        }
      } catch { /* The winner is not authoritative unless every check succeeds. */ }
      return { status: 'BOOTSTRAP_EXISTING_MARKER_CONFLICT' };
    }
    const code = safeBenchmarkFailure(error, 'BOOTSTRAP_FAILED');
    const status = code.startsWith('BENCHMARK_MARKER_') ? 'BOOTSTRAP_EXISTING_MARKER_CONFLICT'
      : code === 'BENCHMARK_EMPTY_OR_REINITIALIZED' ? 'BOOTSTRAP_CORPUS_IDENTITY_INSUFFICIENT'
        : code === 'BENCHMARK_SCHEMA_INCOMPLETE' ? 'BOOTSTRAP_SCHEMA_INCOMPATIBLE' : code;
    return { status };
  } finally { await closeBenchmarkClient(client); }
}
