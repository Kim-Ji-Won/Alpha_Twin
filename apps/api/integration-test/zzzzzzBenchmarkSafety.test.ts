import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Client, Pool } from 'pg';
import { bootstrapBenchmarkMarker } from '../evaluation/filingDense/bootstrapBenchmarkMarker.js';
import { verifyBenchmarkTarget, isTrustedBenchmarkTarget } from '../evaluation/filingDense/verifyBenchmarkTarget.js';
import { BENCHMARK_MARKER_DDL } from '../evaluation/filingDense/benchmarkMarkerDdl.js';
import { BENCHMARK_IDENTITY, REQUIRED_BENCHMARK_MIGRATIONS } from '../evaluation/filingDense/benchmarkMarkerContract.js';
import { BOOTSTRAP_OPT_IN, VERIFY_OPT_IN, benchmarkTargetRejection, createBenchmarkClient, closeBenchmarkClient } from '../evaluation/filingDense/benchmarkTargetPolicy.js';
import { beginBenchmarkReadOnly, inspectBenchmarkCorpus, inspectBenchmarkMarker } from '../evaluation/filingDense/benchmarkInspection.js';
import { runBenchmarkPreflight } from '../evaluation/filingDense/preflight.js';
import { loadFinalDecisionDatasets } from '../evaluation/filingDense/dataset.js';
import { fileURLToPath } from 'node:url';
import { FilingDocumentRepository } from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { FilingLexicalRepository } from '../src/filingIntelligence/lexical/filingLexicalRepository.js';
import { FilingLineageRepository } from '../src/filingIntelligence/lineage/filingLineageRepository.js';
import { FilingEligibilityRepository } from '../src/filingIntelligence/eligibility/filingEligibilityRepository.js';
import { FilingRetrievalActivationRepository } from '../src/filingIntelligence/activation/filingRetrievalActivationRepository.js';
import { FilingRetrievalActivationService } from '../src/filingIntelligence/activation/filingRetrievalActivationService.js';
import { FilingResolutionService } from '../src/filingIntelligence/resolution/service.js';
import { VerifiedFilingGraphRepository } from '../src/filingIntelligence/resolution/graphRepository.js';
import { FILING_RETRIEVAL_POLICY } from '../src/filingIntelligence/eligibility/policies.js';
import { clearPersistence, runMigrations } from './helpers/database.js';
import { syntheticPersistenceInputFor } from './helpers/filingFixture.js';
import { ConcurrencyDiagnostics, sanitizedError, classifyChildFailure } from './helpers/concurrencyDiagnostics.js';

// Dedicated receipt only; no document/family/job descendants are created.
const CONCURRENCY_RECEIPT = ['opendart-fss', '20990923009991', '99999991', '999991',
  'benchmark-snapshot-concurrency-fixture-v1'] as const;
const FIND_CONCURRENCY_RECEIPT = `SELECT id FROM filing_intelligence.filing_receipt
  WHERE provider=$1 AND receipt_number=$2`;
const OWNED_RECEIPT_PREDICATE = 'id=$1 AND provider=$2 AND receipt_number=$3 AND corp_code=$4 AND symbol=$5 AND metadata_source=$6';
const INSERT_CONCURRENCY_RECEIPT = `INSERT INTO filing_intelligence.filing_receipt
  (provider, receipt_number, corp_code, symbol, metadata_source, metadata_observed_at, metadata_fingerprint)
  VALUES ($1,$2,$3,$4,$5,'2099-09-23T00:00:00Z',$6) RETURNING id`;
const DELETE_CONCURRENCY_RECEIPT = `DELETE FROM filing_intelligence.filing_receipt
  WHERE ${OWNED_RECEIPT_PREDICATE} RETURNING id`;
const UPDATE_CONCURRENCY_RECEIPT = `UPDATE filing_intelligence.filing_receipt SET company_name='synthetic-writer-committed'
  WHERE ${OWNED_RECEIPT_PREDICATE} RETURNING id`;
type FixtureDb = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };

async function withConcurrencyReceipt(db: FixtureDb, action: (identity: unknown[]) => Promise<void>, diagnostics?: ConcurrencyDiagnostics): Promise<void> {
  let owned: unknown[] | undefined;
  try {
    diagnostics?.mark('FIXTURE_SETUP_STARTED');
    await db.query('BEGIN');
    const existing = await db.query(FIND_CONCURRENCY_RECEIPT, CONCURRENCY_RECEIPT.slice(0, 2));
    assert.equal(existing.rows.length, 0, 'Fixture identity already exists; never adopt or overwrite');
    const inserted = await db.query(INSERT_CONCURRENCY_RECEIPT, [...CONCURRENCY_RECEIPT, 'c'.repeat(64)]);
    assert.equal(inserted.rowCount, 1);
    const id = inserted.rows[0]?.id;
    assert.ok(typeof id === 'string' && /^[1-9][0-9]*$/.test(id));
    owned = [id, ...CONCURRENCY_RECEIPT];
    await db.query('COMMIT');
    await action(owned);
  } catch (error) {
    diagnostics?.failure(error);
    throw error;
  } finally {
    diagnostics?.mark('FIXTURE_CLEANUP_STARTED');
    // Also undo an interrupted writer before attempting exact fixture cleanup.
    await db.query('ROLLBACK');
    if (owned) {
      try {
        await db.query('BEGIN');
        const deleted = await db.query(DELETE_CONCURRENCY_RECEIPT, owned);
        assert.equal(deleted.rowCount, 1, 'Exact fixture cleanup must remove one row');
        assert.deepEqual(deleted.rows.map(row => row.id), [owned[0]]);
        const remaining = await db.query(FIND_CONCURRENCY_RECEIPT, CONCURRENCY_RECEIPT.slice(0, 2));
        assert.equal(remaining.rows.length, 0, 'Fixture cleanup left a receipt');
        await db.query('COMMIT');
        diagnostics?.mark('FIXTURE_CLEANUP_DONE');
      } catch (error) {
        diagnostics?.failure(error);
        await db.query('ROLLBACK');
        throw error;
      }
    }
  }
}

test('concurrency fixture lifecycle unit contracts (no DB)', async t => {
  t.mock.method(Client.prototype, 'connect', async () => { assert.fail('Unit test must not connect'); });
  await t.test('standalone concurrency entry bypasses destructive suite setup', () => {
    // Supplement the executable lifecycle contracts below with a setup-boundary check.
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const entry = source.split("\ntest('fixture-local snapshot concurrency on prepared disposable corpus',")[1]?.split('\ntest(')[0];
    assert.ok(entry, 'Concurrency must be a standalone top-level test');
    assert.doesNotMatch(entry, /\b(seed|clearPersistence|runMigrations)\s*\(|\b(TRUNCATE|DROP)\s/);
    assert.match(entry, /await withConcurrencyReceipt\(/);
    assert.equal(DELETE_CONCURRENCY_RECEIPT.replace(/\s+/g, ' ').trim(),
      'DELETE FROM filing_intelligence.filing_receipt WHERE id=$1 AND provider=$2 AND receipt_number=$3 AND corp_code=$4 AND symbol=$5 AND metadata_source=$6 RETURNING id');
    assert.ok(UPDATE_CONCURRENCY_RECEIPT.endsWith(`WHERE ${OWNED_RECEIPT_PREDICATE} RETURNING id`));
  });
  for (const scenario of ['success', 'action failure', 'collision', 'insert failure', 'cleanup zero', 'cleanup excess'] as const) {
    await t.test(scenario, async () => {
      const calls: { sql: string; values?: unknown[] }[] = [];
      let exists = scenario === 'collision';
      let actionCalled = false;
      const db: FixtureDb = { query: async (sql, values) => {
        calls.push({ sql, values });
        if (sql === FIND_CONCURRENCY_RECEIPT) return { rows: exists ? [{ id: '71' }] : [], rowCount: exists ? 1 : 0 };
        if (sql === INSERT_CONCURRENCY_RECEIPT) {
          if (scenario === 'insert failure') throw new Error('synthetic insert failure');
          exists = true;
          return { rows: [{ id: '71' }], rowCount: 1 };
        }
        if (sql === DELETE_CONCURRENCY_RECEIPT) {
          assert.equal(actionCalled, true, 'Action assertions precede cleanup');
          assert.deepEqual(values, ['71', ...CONCURRENCY_RECEIPT]);
          exists = false;
          return { rows: [{ id: '71' }], rowCount: scenario === 'cleanup zero' ? 0 : scenario === 'cleanup excess' ? 2 : 1 };
        }
        assert.ok(['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql), 'No destructive or unrecognized fixture SQL');
        return { rows: [], rowCount: null };
      } };
      const run = () => withConcurrencyReceipt(db, async identity => {
        actionCalled = true;
        assert.deepEqual(identity, ['71', ...CONCURRENCY_RECEIPT]);
        if (scenario === 'action failure') throw new Error('synthetic action failure');
      });
      if (scenario === 'success') await run();
      else await assert.rejects(run);
      if (scenario === 'collision' || scenario === 'insert failure') {
        assert.equal(actionCalled, false);
        assert.equal(calls.some(call => call.sql === DELETE_CONCURRENCY_RECEIPT), false);
      } else assert.equal(calls.filter(call => call.sql === DELETE_CONCURRENCY_RECEIPT).length, 1);
      if (scenario !== 'success' && scenario !== 'action failure') assert.equal(calls.at(-1)?.sql, 'ROLLBACK');
    });
  }
});

test('concurrency diagnostic instrumentation (no DB)', async t => {
  t.mock.method(Client.prototype, 'connect', async () => { assert.fail('No DB allowed'); });
  await t.test('primary stage survives cleanup; ordered structured events', () => {
    const lines: string[] = [];
    const trace = new ConcurrencyDiagnostics(line => lines.push(line));
    trace.mark('PRECHECK_START'); trace.mark('WRITER_STARTED');
    trace.failure(new Error('postgresql://secret:password@host API_KEY=sentinel'));
    trace.mark('FIXTURE_CLEANUP_STARTED'); trace.failure(new Error('secondary'));
    const events = lines.map(line => JSON.parse(line.slice('CONCURRENCY_DIAGNOSTIC '.length)));
    assert.deepEqual(events.filter(e => e.kind === 'stage').map(e => e.sequence), [1, 2, 3]);
    assert.equal(events[2].stage, 'WRITER_STARTED'); assert.equal(events[2].primary, true);
    assert.equal(events[4].primary, false);
    assert.doesNotMatch(lines.join(''), /postgresql|password|sentinel|secondary/);
  });
  await t.test('SQLSTATE and Node code allowlists never echo message or custom name', () => {
    const error = Object.assign(new Error('password=SECRET'), { code: '42703', name: 'SECRET' });
    assert.equal(sanitizedError(error).sqlstate, '42703');
    assert.equal(sanitizedError(error).name, 'UnknownError');
    assert.equal(sanitizedError(Object.assign(error, { code: 'ECONNREFUSED' })).nodeCode, 'ECONNREFUSED');
    assert.equal(sanitizedError(Object.assign(error, { code: 'SECRET' })).nodeCode, null);
    assert.doesNotMatch(JSON.stringify(sanitizedError(error)), /SECRET|password/);
  });
  await t.test('child spawn, import, pre-body, pre-connect and post-connect failures', () => {
    const base = { exitCode: 1, signal: null, output: 'password=SECRET', bodyEntered: false, connected: false };
    assert.equal(classifyChildFailure({ ...base, spawnError: new Error('SECRET') }).phase, 'spawn failure');
    assert.equal(classifyChildFailure({ ...base, output: 'ERR_MODULE_NOT_FOUND SECRET' }).category, 'module import/preload failure');
    assert.equal(classifyChildFailure(base).phase, 'before test body');
    assert.equal(classifyChildFailure({ ...base, bodyEntered: true }).phase, 'before DB connection');
    const result = classifyChildFailure({ ...base, bodyEntered: true, connected: true, signal: 'SIGTERM' });
    assert.equal(result.phase, 'after DB connection'); assert.equal(result.signal, 'SIGTERM');
    assert.equal(result.exitCode, 1); assert.doesNotMatch(JSON.stringify(result), /SECRET|password/);
  });
});

// Run by its exact name only against a separately prepared, approved disposable corpus.
// This top-level test never executes the destructive suite's migration/seed hooks.
test('fixture-local snapshot concurrency on prepared disposable corpus', async t => {
  const diagnostics = new ConcurrencyDiagnostics();
  diagnostics.mark('PRECHECK_START');
  let writer: Client | undefined;
  try {
  assert.equal(process.env.ALPHA_TWIN_SYNTHETIC_BENCHMARK_TEST, '1');
  assert.equal(benchmarkTargetRejection('verify'), null);
  assert.equal(benchmarkTargetRejection('bootstrap'), null);
  diagnostics.mark('PRECHECK_DONE');
  writer = createBenchmarkClient('verify');
  const fixtureWriter = writer;
  try {
    diagnostics.mark('CONNECTION_STARTED');
    await writer.connect();
    diagnostics.connected = true;
    diagnostics.mark('CONNECTION_ESTABLISHED');
    await beginBenchmarkReadOnly(writer);
    diagnostics.transactionBegun = true;
    assert.equal(await inspectBenchmarkMarker(writer), 'absent', 'Never remove an existing marker');
    const baseline = await inspectBenchmarkCorpus(writer);
    diagnostics.mark('BASELINE_CAPTURED');
    await writer.query('ROLLBACK');
    diagnostics.transactionBegun = false;
    try {
      await withConcurrencyReceipt(writer, async identity => {
        const writer = fixtureWriter;
        const query = Client.prototype.query;
        let writeIsolation: string | undefined;
        let sawBlockedLock = false;
        let sessionDefaultVerified = false;
        let writerCommitted = false;
        let bootstrapRolledBack = false;
        let markerMutations = 0;
        let postLock = false;
        const fingerprints: string[] = [];
        let currentFingerprint: string[] = [];
        const spy = t.mock.method(Client.prototype, 'query', async function(this: Client, ...args: unknown[]) {
          try {
          // Writer and cleanup use the real driver without bootstrap instrumentation.
          if (this === writer) return Reflect.apply(query, this, args);
          const sql = args[0];
          if (sql === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY') {
            await Reflect.apply(query, this, ["SET SESSION default_transaction_isolation TO 'repeatable read'"]);
            const setting = await Reflect.apply(query, this, ['SHOW default_transaction_isolation']);
            assert.equal(setting.rows[0].default_transaction_isolation, 'repeatable read');
            sessionDefaultVerified = true;
            diagnostics.mark('SESSION_ISOLATION_SET');
          }
          if (sql === 'SHOW transaction_isolation') {
            const result = await Reflect.apply(query, this, args);
            writeIsolation = result.rows[0].transaction_isolation;
            if (writeIsolation === 'read committed') diagnostics.mark('BOOTSTRAP_ISOLATION_CONFIRMED');
            return result;
          }
          if (sql === BENCHMARK_MARKER_DDL || (typeof sql === 'string' && sql.startsWith('INSERT INTO public.benchmark_environment_marker'))) markerMutations++;
          if (sql === 'ROLLBACK' && writerCommitted) {
            const result = await Reflect.apply(query, this, args);
            bootstrapRolledBack = true;
            diagnostics.transactionBegun = false;
            diagnostics.mark('BOOTSTRAP_ROLLBACK_CONFIRMED');
            return result;
          }
          if (typeof sql === 'string' && sql.startsWith('LOCK TABLE public.pgmigrations,')) {
            const pid = (await Reflect.apply(query, this, ['SELECT pg_backend_pid() AS pid'])).rows[0].pid;
            await writer.query('BEGIN');
            diagnostics.transactionBegun = true;
            diagnostics.mark('WRITER_STARTED');
            assert.equal((await writer.query(UPDATE_CONCURRENCY_RECEIPT, identity)).rowCount, 1);
            diagnostics.mark('WRITER_MUTATION_APPLIED');
            const pending = Reflect.apply(query, this, args);
            void pending.catch(() => {});
            try {
              const deadline = Date.now() + 2_000;
              while (Date.now() < deadline) {
                const blocking = await writer.query('SELECT pg_backend_pid() = ANY(pg_blocking_pids($1)) AS blocked', [pid]);
                if (blocking.rows[0].blocked) { sawBlockedLock = true; break; }
              }
              assert.equal(sawBlockedLock, true, 'Bootstrap must wait for the fixture writer');
              diagnostics.mark('RELATION_LOCK_WAIT_ENTERED');
              await writer.query('COMMIT');
              writerCommitted = true;
              diagnostics.mark('WRITER_COMMITTED');
              const result = await pending;
              postLock = true;
              diagnostics.mark('BOOTSTRAP_RESUMED');
              return result;
            } catch (error) {
              diagnostics.failure(error);
              await writer.query('ROLLBACK');
              await pending.catch(() => {});
              throw error;
            }
          }
          const result = await Reflect.apply(query, this, args);
          if (sql === 'BEGIN ISOLATION LEVEL READ COMMITTED') diagnostics.transactionBegun = true;
          if (sql === 'SELECT pg_catalog.pg_advisory_xact_lock(173528, 1)') diagnostics.mark('ADVISORY_LOCK_ACQUIRED');
          // Observe existing inspection results only; no extra SQL or transaction changes.
          if (typeof sql === 'string' && sql.includes('md5(coalesce(string_agg(identity')) {
            const table = sql.match(/FROM filing_intelligence\.(\w+)/)?.[1];
            currentFingerprint.push(`${table}:${result.rows[0].count}:${result.rows[0].fingerprint}`);
            if (table === 'filing_retrieval_activation_history') {
              fingerprints.push(currentFingerprint.join('|')); currentFingerprint = [];
              if (postLock) {
                diagnostics.mark('POST_LOCK_INSPECTION_DONE');
                if (fingerprints.length === 2 && fingerprints[0] !== fingerprints[1]) {
                  diagnostics.mark('FINGERPRINT_MISMATCH_CONFIRMED');
                }
              }
            }
          }
          return result;
          } catch (error) { diagnostics.failure(error); throw error; }
        });
        try {
          diagnostics.mark('BOOTSTRAP_STARTED');
          assert.equal((await bootstrapBenchmarkMarker()).status, 'BOOTSTRAP_CORPUS_IDENTITY_INSUFFICIENT');
          assert.equal(sessionDefaultVerified, true);
          assert.equal(writeIsolation, 'read committed');
          assert.equal(sawBlockedLock, true);
          assert.equal(writerCommitted, true);
          assert.equal(bootstrapRolledBack, true);
          assert.equal(markerMutations, 0);
          diagnostics.mark('MARKER_MUTATION_BLOCKED');
          assert.equal((await writer.query("SELECT to_regclass('public.benchmark_environment_marker') AS relation")).rows[0].relation, null);
        } catch (error) { diagnostics.failure(error); throw error; }
        finally { spy.mock.restore(); }
      }, diagnostics);
    } finally {
      // Do not repair unexpected marker creation or unrelated corpus changes.
      await beginBenchmarkReadOnly(writer);
      assert.equal(await inspectBenchmarkMarker(writer), 'absent');
      const after = await inspectBenchmarkCorpus(writer);
      assert.deepEqual(after, baseline, 'Cleanup must restore the baseline corpus');
      diagnostics.mark('POST_BASELINE_CONFIRMED');
      await writer.query('ROLLBACK');
    }
  } finally { await closeBenchmarkClient(writer); }
  } catch (error) { diagnostics.failure(error); throw error; }
});

test('benchmark safety on explicitly disposable PostgreSQL only', async t => {
  assert.equal(process.env.ALPHA_TWIN_SYNTHETIC_BENCHMARK_TEST, '1', 'Disposable test opt-in required');
  const original = { ...process.env };
  process.env[VERIFY_OPT_IN] = '1';
  process.env[BOOTSTRAP_OPT_IN] = '1';
  t.after(() => { process.env = original; });
  assert.equal(benchmarkTargetRejection('verify'), null);
  const url = process.env.TEST_DATABASE_URL!;
  const pool = new Pool({ connectionString: url });
  t.after(async () => { await pool.end(); });
  await runMigrations('up', url, true, true);

  async function seed() {
    await pool.query('DROP TABLE IF EXISTS public.benchmark_environment_marker');
    await clearPersistence(pool);
    const receipt = '20990918000001';
    const company = { corpCode: '99999999', symbol: '999999' };
    const input = syntheticPersistenceInputFor({ receiptNumber: receipt, ...company });
    await new FilingLineageRepository(pool).persistReceipt({ provider: 'opendart-fss', receiptNumber: receipt,
      ...company, companyName: input.metadata.companyName, reportName: input.metadata.reportName, reportCode: '11011',
      filingDate: '2099-01-01', legalStatus: 'reported_active', metadataSource: 'synthetic-benchmark-test',
      metadataObservedAt: '2099-09-18T00:00:00.000Z' });
    const saved = await new FilingDocumentRepository(pool).persistCanonicalFiling(input);
    await new FilingLexicalRepository(pool).indexFilingDocumentLexically(saved.documentId);
    const family = { provider: 'opendart-fss' as const, ...company, lineageRootReceiptNumber: receipt,
      verificationSource: 'trusted_backfill' as const, verificationReferenceHash: 'a'.repeat(64) };
    await new FilingLineageRepository(pool).persistVerifiedReportFamily(family);
    const graphs = new VerifiedFilingGraphRepository(pool);
    await new FilingRetrievalActivationService(new FilingRetrievalActivationRepository(pool), graphs,
      new FilingEligibilityRepository(pool)).apply({ retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      resolution: await new FilingResolutionService(graphs).resolveCurrentEffectiveReceiptCandidate(family) });
  }
  async function exactMarker() {
    await pool.query(BENCHMARK_MARKER_DDL);
    await pool.query('INSERT INTO public.benchmark_environment_marker VALUES ($1,$2,$3)',
      [BENCHMARK_IDENTITY.markerId, BENCHMARK_IDENTITY.purpose, BENCHMARK_IDENTITY.databaseName]);
  }
  async function markerSnapshot() {
    return (await pool.query(`SELECT tableoid::text, xmin::text, ctid::text, marker_id, purpose, database_name
      FROM public.benchmark_environment_marker`)).rows;
  }

  await t.test('missing marker is not created by verifier; bootstrap then positive read-only proof', async () => {
    await seed();
    assert.equal((await verifyBenchmarkTarget()).status, 'BENCHMARK_MARKER_MISSING');
    assert.equal((await pool.query("SELECT to_regclass('public.benchmark_environment_marker') AS relation")).rows[0].relation, null);
    assert.equal((await bootstrapBenchmarkMarker()).status, 'BOOTSTRAPPED');
    const before = await markerSnapshot();
    const result = await verifyBenchmarkTarget();
    assert.equal(result.status, 'BENCHMARK_TARGET_VERIFIED');
    if (result.status !== 'BENCHMARK_TARGET_VERIFIED') return;
    assert.equal(isTrustedBenchmarkTarget(result.evidence), true);
    assert.equal(isTrustedBenchmarkTarget({ ...result.evidence }), false);
    assert.equal(Object.isFrozen(result.evidence), true);
    assert.equal(Object.isFrozen(result.evidence.inventorySummary), true);
    assert.equal(result.evidence.inventorySummary.documents, 1);
    assert.ok(result.evidence.inventorySummary.activations > 0);
    assert.equal((await bootstrapBenchmarkMarker()).status, 'ALREADY_BOOTSTRAPPED');
    assert.deepEqual(await markerSnapshot(), before);
    const datasets = await loadFinalDecisionDatasets(fileURLToPath(new URL('../evaluation/fixtures/dense-eval-v1', import.meta.url)),
      { allowSealedHoldout: true });
    const args = { ...datasets, registeredProfiles: [], requiredProfileIds: ['a', 'b'] as const,
      database: result.evidence, liveBudget: { enabled: false, explicitlyApproved: false, maxOpenAiCalls: 0,
        maxInputTokens: 0, maxEstimatedCostAtomicUnits: 0n }, pricingSnapshotProvided: false,
      benchmarkConfigValid: false, hostMetadataAvailable: false, largeCalibrationStatus: 'not_verified' as const,
      bothProfilesFullScopeReady: false, performanceFixtureCandidateRows: 0 };
    assert.equal(runBenchmarkPreflight(args).reasons.includes('PRODUCTION_DATABASE_GUARD'), false);
    assert.equal(runBenchmarkPreflight({ ...args, database: { ...result.evidence } }).reasons.includes('PRODUCTION_DATABASE_GUARD'), true);
  });

  await t.test('bootstrap serializes concurrent attempts without replacement', async () => {
    await seed();
    const results = await Promise.all([bootstrapBenchmarkMarker(), bootstrapBenchmarkMarker()]);
    assert.deepEqual(results.map(r => r.status).sort(), ['ALREADY_BOOTSTRAPPED', 'BOOTSTRAPPED']);
    assert.equal((await pool.query('SELECT count(*) FROM public.benchmark_environment_marker')).rows[0].count, '1');
  });

  await t.test('fixed values are enforced by the database', async () => {
    for (const column of ['marker_id', 'purpose', 'database_name']) {
      await assert.rejects(pool.query(`UPDATE public.benchmark_environment_marker SET ${column}='wrong'`),
        (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === '23514');
    }
  });

  await t.test('empty marker table conflicts; bootstrap never fills it', async () => {
    await seed(); await pool.query(BENCHMARK_MARKER_DDL);
    assert.equal((await verifyBenchmarkTarget()).status, 'BENCHMARK_MARKER_MISSING');
    assert.equal((await bootstrapBenchmarkMarker()).status, 'BOOTSTRAP_EXISTING_MARKER_CONFLICT');
    assert.equal((await pool.query('SELECT count(*) FROM public.benchmark_environment_marker')).rows[0].count, '0');
  });

  for (const value of ['marker_id', 'purpose', 'database_name', 'duplicate']) await t.test(`malformed marker ${value} is refused`, async () => {
    await seed();
    await pool.query('CREATE TABLE public.benchmark_environment_marker (marker_id text, purpose text, database_name text)');
    const values = [BENCHMARK_IDENTITY.markerId, BENCHMARK_IDENTITY.purpose, BENCHMARK_IDENTITY.databaseName] as string[];
    if (value !== 'duplicate') values[['marker_id', 'purpose', 'database_name'].indexOf(value)] = 'wrong';
    await pool.query('INSERT INTO public.benchmark_environment_marker VALUES ($1,$2,$3)', values);
    if (value === 'duplicate') await pool.query('INSERT INTO public.benchmark_environment_marker VALUES ($1,$2,$3)', values);
    const before = await markerSnapshot();
    assert.equal((await verifyBenchmarkTarget()).status, 'BENCHMARK_MARKER_SCHEMA_INVALID');
    assert.equal((await bootstrapBenchmarkMarker()).status, 'BOOTSTRAP_EXISTING_MARKER_CONFLICT');
    assert.deepEqual(await markerSnapshot(), before);
  });

  await t.test('view masquerading as marker is refused', async () => {
    await seed();
    await pool.query(`CREATE VIEW public.benchmark_environment_marker AS SELECT
      'alpha-twin-dense-benchmark@1'::text AS marker_id, 'disposable-evaluation'::text AS purpose,
      'alpha_twin_benchmark_test'::text AS database_name`);
    try {
      assert.equal((await verifyBenchmarkTarget()).status, 'BENCHMARK_MARKER_SCHEMA_INVALID');
      assert.equal((await bootstrapBenchmarkMarker()).status, 'BOOTSTRAP_EXISTING_MARKER_CONFLICT');
    } finally { await pool.query('DROP VIEW public.benchmark_environment_marker'); }
  });

  for (const ddl of ['ADD COLUMN extra text', 'ALTER COLUMN purpose DROP NOT NULL',
    'DROP CONSTRAINT benchmark_marker_purpose_check', 'ENABLE ROW LEVEL SECURITY']) {
    await t.test(`invalid marker schema: ${ddl}`, async () => {
      await seed(); await exactMarker();
      await pool.query(`ALTER TABLE public.benchmark_environment_marker ${ddl}`);
      assert.equal((await verifyBenchmarkTarget()).status, 'BENCHMARK_MARKER_SCHEMA_INVALID');
    });
  }

  await t.test('missing migration is refused without repair', async () => {
    await seed(); await exactMarker();
    const name = REQUIRED_BENCHMARK_MIGRATIONS.at(-1)!;
    await pool.query('UPDATE public.pgmigrations SET name=$1 WHERE name=$2', ['missing', name]);
    try {
      assert.equal((await verifyBenchmarkTarget()).status, 'BENCHMARK_SCHEMA_INCOMPLETE');
      assert.equal((await bootstrapBenchmarkMarker()).status, 'BOOTSTRAP_SCHEMA_INCOMPATIBLE');
    } finally { await pool.query('UPDATE public.pgmigrations SET name=$1 WHERE name=$2', [name, 'missing']); }
  });

  await t.test('empty corpus cannot be legitimized by bootstrap or exact marker', async () => {
    await seed(); await clearPersistence(pool);
    assert.equal((await bootstrapBenchmarkMarker()).status, 'BOOTSTRAP_CORPUS_IDENTITY_INSUFFICIENT');
    assert.equal((await pool.query("SELECT to_regclass('public.benchmark_environment_marker') AS relation")).rows[0].relation, null);
    await exactMarker();
    assert.equal((await verifyBenchmarkTarget()).status, 'BENCHMARK_EMPTY_OR_REINITIALIZED');
  });

  await t.test('read-only transaction rejects test-only insert with SQLSTATE 25006', async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await beginBenchmarkReadOnly(client);
      assert.equal((await client.query('SHOW transaction_isolation')).rows[0].transaction_isolation, 'repeatable read');
      await assert.rejects(client.query('INSERT INTO public.benchmark_environment_marker VALUES ($1,$2,$3)', ['x', 'x', 'x']),
        (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === '25006');
    } finally { await client.query('ROLLBACK'); await client.end(); }
  });

  await t.test('bootstrap rolls back table creation if insert fails', async () => {
    await seed();
    const query = Client.prototype.query;
    const spy = t.mock.method(Client.prototype, 'query', function(this: Client, ...args: unknown[]) {
      if (typeof args[0] === 'string' && args[0].startsWith('INSERT INTO public.benchmark_environment_marker')) {
        return Promise.reject(new Error('password_SENTINEL'));
      }
      return Reflect.apply(query, this, args);
    });
    try { assert.deepEqual(await bootstrapBenchmarkMarker(), { status: 'BOOTSTRAP_FAILED' }); }
    finally { spy.mock.restore(); }
    assert.equal((await pool.query("SELECT to_regclass('public.benchmark_environment_marker') AS relation")).rows[0].relation, null);
  });

  await t.test('changed continuity between preflight and mutation is refused', async () => {
    await seed();
    const query = Client.prototype.query;
    let changed = false;
    const spy = t.mock.method(Client.prototype, 'query', function(this: Client, ...args: unknown[]) {
      if (args[0] === 'BEGIN ISOLATION LEVEL READ COMMITTED' && !changed) {
        changed = true;
        return pool.query('UPDATE filing_intelligence.filing_document SET company_name=company_name')
          .then(() => Reflect.apply(query, this, args));
      }
      return Reflect.apply(query, this, args);
    });
    try { assert.equal((await bootstrapBenchmarkMarker()).status, 'BOOTSTRAP_CORPUS_IDENTITY_INSUFFICIENT'); }
    finally { spy.mock.restore(); }
    assert.equal(changed, true);
    assert.equal((await pool.query("SELECT to_regclass('public.benchmark_environment_marker') AS relation")).rows[0].relation, null);
  });

  for (const conflicting of [false, true]) await t.test(`non-cooperating marker creation race; conflict=${conflicting}`, async () => {
    await seed();
    const query = Client.prototype.query;
    let raced = false;
    const spy = t.mock.method(Client.prototype, 'query', function(this: Client, ...args: unknown[]) {
      if (args[0] === BENCHMARK_MARKER_DDL && !raced) {
        raced = true;
        return (conflicting
          ? pool.query('CREATE TABLE public.benchmark_environment_marker (marker_id text)')
          : exactMarker()).then(() => Reflect.apply(query, this, args));
      }
      return Reflect.apply(query, this, args);
    });
    try {
      assert.equal((await bootstrapBenchmarkMarker()).status,
        conflicting ? 'BOOTSTRAP_EXISTING_MARKER_CONFLICT' : 'ALREADY_BOOTSTRAPPED');
      assert.equal(raced, true);
    } finally { spy.mock.restore(); }
  });

  await t.test('secret sentinels remain absent through marker and schema failures', async () => {
    await seed(); await exactMarker();
    const originalUrl = process.env.TEST_DATABASE_URL;
    const secretUrl = new URL(url);
    secretUrl.password = 'BENCHMARK_PASSWORD_SENTINEL';
    process.env.TEST_DATABASE_URL = secretUrl.toString();
    const logs: unknown[] = [];
    const log = t.mock.method(console, 'log', (...args: unknown[]) => { logs.push(args); });
    const error = t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
    try {
      await pool.query('ALTER TABLE public.benchmark_environment_marker ADD COLUMN unexpected text');
      for (const run of [verifyBenchmarkTarget, bootstrapBenchmarkMarker]) {
        assert.ok(!JSON.stringify(await run()).includes('SENTINEL'));
      }
      await pool.query('DROP TABLE public.benchmark_environment_marker');
      await exactMarker();
      await pool.query('ALTER TABLE public.pgmigrations ENABLE ROW LEVEL SECURITY');
      try {
        assert.equal((await verifyBenchmarkTarget()).status, 'BENCHMARK_SCHEMA_INCOMPLETE');
        assert.equal((await bootstrapBenchmarkMarker()).status, 'BOOTSTRAP_SCHEMA_INCOMPATIBLE');
      } finally { await pool.query('ALTER TABLE public.pgmigrations DISABLE ROW LEVEL SECURITY'); }
      assert.deepEqual(logs, []);
    } finally {
      process.env.TEST_DATABASE_URL = originalUrl;
      log.mock.restore(); error.mock.restore();
    }
  });

  await t.test('verifier works with a non-owner SELECT-only role', async () => {
    await seed(); await exactMarker();
    await pool.query('CREATE ROLE benchmark_safety_reader NOSUPERUSER NOCREATEDB NOCREATEROLE LOGIN');
    await pool.query('GRANT USAGE ON SCHEMA public, filing_intelligence TO benchmark_safety_reader');
    await pool.query('GRANT SELECT ON ALL TABLES IN SCHEMA public, filing_intelligence TO benchmark_safety_reader');
    const originalUrl = process.env.TEST_DATABASE_URL;
    const readUrl = new URL(url); readUrl.username = 'benchmark_safety_reader';
    process.env.TEST_DATABASE_URL = readUrl.toString();
    try {
      assert.equal((await verifyBenchmarkTarget()).status, 'BENCHMARK_TARGET_VERIFIED');
      const reader = new Client({ connectionString: readUrl.toString() });
      await reader.connect();
      try {
        await assert.rejects(reader.query('DELETE FROM public.benchmark_environment_marker'),
          (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === '42501');
      } finally { await reader.end(); }
    } finally {
      process.env.TEST_DATABASE_URL = originalUrl;
      await pool.query('DROP OWNED BY benchmark_safety_reader');
      await pool.query('DROP ROLE benchmark_safety_reader');
    }
  });
});
