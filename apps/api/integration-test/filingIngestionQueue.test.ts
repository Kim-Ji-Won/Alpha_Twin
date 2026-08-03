import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import {
  CANONICAL_FILING_SCHEMA_NAME, CANONICAL_FILING_SCHEMA_VERSION,
  FILING_CHUNKER_VERSION, FILING_CHUNK_SCHEMA_VERSION, FILING_XML_PARSER_VERSION,
} from '../src/openDart/document/canonicalFilingContracts.js';
import { FilingDocumentRepository } from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { FilingPersistenceError } from '../src/filingIntelligence/persistence/errors.js';
import { VerifiedIngestionJobInput } from '../src/filingIntelligence/ingestion/contracts.js';
import { FilingIngestionWorker } from '../src/filingIntelligence/ingestion/filingIngestionWorker.js';
import { IngestionJobRepository } from '../src/filingIntelligence/ingestion/ingestionJobRepository.js';
import { OpenDartError } from '../src/openDart/errors.js';
import { clearPersistence, requiredTestDatabaseUrl, runMigrations } from './helpers/database.js';
import { SYNTHETIC_RECEIPT, syntheticArchive } from './helpers/filingFixture.js';

const NOW = new Date('2099-01-02T00:00:00.000Z');
const LEASE_MS = 300_000;
function token(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function input(overrides: Partial<VerifiedIngestionJobInput> = {}): VerifiedIngestionJobInput {
  return {
    provider: 'opendart-fss', receiptNumber: SYNTHETIC_RECEIPT,
    corpCode: '99999999', symbol: '999999', companyName: 'ALPHA TWIN TEST COMPANY',
    reportName: '합성 사업보고서', reportCode: '11011', filingDate: '2099-01-01',
    canonicalSchemaName: CANONICAL_FILING_SCHEMA_NAME,
    canonicalSchemaVersion: String(CANONICAL_FILING_SCHEMA_VERSION),
    parserVersion: FILING_XML_PARSER_VERSION,
    chunkSchemaVersion: String(FILING_CHUNK_SCHEMA_VERSION),
    chunkerVersion: FILING_CHUNKER_VERSION,
    ...overrides,
  };
}
function repository(pool: Pool): IngestionJobRepository {
  let index = 0;
  return new IngestionJobRepository(pool, () => token(++index), () => 0);
}
const workerConfig = {
  workerId: 'integration-worker', pollIntervalMs: 100, leaseMs: LEASE_MS,
  heartbeatMs: 30_000, shutdownGraceMs: 1_000, reclaimBatchSize: 20,
};

async function expireLease(pool: Pool, jobId: string): Promise<void> {
  await pool.query(
    `UPDATE filing_intelligence.filing_ingestion_job
     SET lease_expires_at = clock_timestamp() - interval '1 millisecond'
     WHERE id = $1 AND status = 'leased'`,
    [jobId],
  );
}

async function makeAvailable(pool: Pool, jobId: string): Promise<void> {
  await pool.query(
    `UPDATE filing_intelligence.filing_ingestion_job
     SET available_at = clock_timestamp()
     WHERE id = $1 AND status = 'retryable_failed'`,
    [jobId],
  );
}

function malformedArchive(receiptNumber: string) {
  const archive = syntheticArchive(5, receiptNumber);
  const content = Buffer.from('<DOCUMENT><BODY>');
  const hash = createHash('sha256').update(content).digest('hex');
  return {
    ...archive,
    archiveByteLength: content.length,
    archiveSha256: hash,
    declaredTotalUncompressedBytes: content.length,
    extractedTotalUncompressedBytes: content.length,
    entries: [{ ...archive.entries[0]!, compressedSize: content.length,
      uncompressedSize: content.length, sha256: hash, content }],
  };
}

test('filing ingestion PostgreSQL orchestration', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 2_000,
    statement_timeout: 30_000, application_name: 'alpha-twin-ingestion-integration-test' });
  t.after(async () => { await pool.end(); });
  await runMigrations('up', databaseUrl);

  await t.test('migration exposes constrained job, attempt, FK, and queue indexes', async () => {
    const constraints = await pool.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE constraint_schema = 'filing_intelligence'
         AND table_name IN ('filing_ingestion_job', 'filing_ingestion_attempt')`,
    );
    const names = new Set(constraints.rows.map(row => row.constraint_name));
    for (const name of ['filing_ingestion_job_identity_unique', 'filing_ingestion_job_lease_consistency',
      'filing_ingestion_job_terminal_consistency', 'filing_ingestion_attempt_job_number_unique']) {
      assert.equal(names.has(name), true, name);
    }
    const indexes = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'filing_intelligence'
         AND tablename IN ('filing_ingestion_job', 'filing_ingestion_attempt')`,
    );
    const indexNames = new Set(indexes.rows.map(row => row.indexname));
    assert.equal(indexNames.has('filing_ingestion_job_claim_idx'), true);
    assert.equal(indexNames.has('filing_ingestion_job_expired_lease_idx'), true);
  });

  await t.test('enqueue is idempotent and rejects invalid metadata before writing', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    const first = await jobs.enqueueVerifiedJob(input(), NOW);
    const duplicate = await jobs.enqueueVerifiedJob(input(), NOW);
    assert.equal(first.status, 'enqueued');
    assert.equal(duplicate.status, 'already_enqueued');
    assert.equal(first.jobId, duplicate.jobId);
    await assert.rejects(jobs.enqueueVerifiedJob(input({ symbol: 'unsafe' }), NOW));
    const count = await pool.query<{ count: string }>('SELECT count(*) FROM filing_intelligence.filing_ingestion_job');
    assert.equal(count.rows[0]?.count, '1');
  });

  await t.test('claim honors priority and creates the running attempt atomically', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000002', priority: 1 }), NOW);
    const high = await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000003', priority: 9 }), NOW);
    await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000004', priority: 100,
      availableAt: new Date(NOW.getTime() + 60_000) }), NOW);
    const claim = await jobs.claimNextJob({ workerId: 'worker-a', now: NOW, leaseMs: LEASE_MS });
    assert.equal(claim?.id, high.jobId);
    assert.equal(claim?.attemptNumber, 1);
    const attempts = await jobs.findAttempts(high.jobId);
    assert.deepEqual(attempts.map(value => value.outcome), ['running']);
  });

  await t.test('concurrent claimers never receive the same job', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000005' }), NOW);
    const [left, right] = await Promise.all([
      jobs.claimNextJob({ workerId: 'worker-a', now: NOW, leaseMs: LEASE_MS }),
      jobs.claimNextJob({ workerId: 'worker-b', now: NOW, leaseMs: LEASE_MS }),
    ]);
    assert.equal([left, right].filter(Boolean).length, 1);
  });

  await t.test('SKIP LOCKED claims another available row while the first row is locked', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    const first = await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000006', priority: 10 }), NOW);
    const second = await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000007', priority: 5 }), NOW);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM filing_intelligence.filing_ingestion_job WHERE id = $1 FOR UPDATE', [first.jobId]);
      const claim = await jobs.claimNextJob({ workerId: 'worker-b', now: NOW, leaseMs: LEASE_MS });
      assert.equal(claim?.id, second.jobId);
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });

  await t.test('heartbeat requires the live token and expired leases are reclaimed once', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    const queued = await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000008' }), NOW);
    const claim = await jobs.claimNextJob({ workerId: 'worker-a', now: NOW, leaseMs: LEASE_MS });
    assert.ok(claim);
    assert.equal((await jobs.heartbeatLease(queued.jobId, token(999), NOW, LEASE_MS)).status, 'lease_lost');
    assert.equal((await jobs.heartbeatLease(queued.jobId, claim.leaseToken, NOW, LEASE_MS)).status, 'updated');
    await expireLease(pool, queued.jobId);
    const future = new Date(NOW.getTime() + LEASE_MS + 1);
    assert.equal(await jobs.reclaimExpiredLeases({ now: future, limit: 10 }), 1);
    assert.equal(await jobs.reclaimExpiredLeases({ now: future, limit: 10 }), 0);
    assert.equal((await jobs.findJobById(queued.jobId))?.status, 'retryable_failed');
    assert.deepEqual((await jobs.findAttempts(queued.jobId)).map(value => value.outcome), ['lease_expired']);
  });

  await t.test('database time governs availability, heartbeat, and reclaim despite host clock skew', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    const queued = await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000011' }), NOW);
    const hostPast = new Date('1970-01-01T00:00:00.000Z');
    const hostFuture = new Date('2200-01-01T00:00:00.000Z');
    const claim = await jobs.claimNextJob({ workerId: 'skewed-worker', now: hostPast, leaseMs: LEASE_MS });
    assert.ok(claim);
    const databaseClock = await pool.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    const remainingMs = claim.leaseExpiresAt.getTime() - databaseClock.rows[0]!.now.getTime();
    assert.ok(remainingMs > LEASE_MS - 10_000 && remainingMs <= LEASE_MS);
    assert.equal((await jobs.heartbeatLease(queued.jobId, claim.leaseToken, hostFuture, LEASE_MS)).status, 'updated');
    await expireLease(pool, queued.jobId);
    assert.equal((await jobs.heartbeatLease(queued.jobId, claim.leaseToken, hostPast, LEASE_MS)).status, 'lease_lost');
    assert.equal(await jobs.reclaimExpiredLeases({ now: hostPast, limit: 10 }), 1);
  });

  await t.test('concurrent reclaimers close one expired attempt exactly once', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    const queued = await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000010' }), NOW);
    await jobs.claimNextJob({ workerId: 'worker-a', now: NOW, leaseMs: LEASE_MS });
    await expireLease(pool, queued.jobId);
    const future = new Date(NOW.getTime() + LEASE_MS + 1);
    const reclaimed = await Promise.all([
      jobs.reclaimExpiredLeases({ now: future, limit: 10 }),
      jobs.reclaimExpiredLeases({ now: future, limit: 10 }),
    ]);
    assert.equal(reclaimed[0]! + reclaimed[1]!, 1);
    assert.equal((await jobs.findAttempts(queued.jobId)).length, 1);
  });

  await t.test('max-attempt expiry becomes terminal and cannot be claimed again', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    const queued = await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000009', maxAttempts: 1 }), NOW);
    await jobs.claimNextJob({ workerId: 'worker-a', now: NOW, leaseMs: LEASE_MS });
    await expireLease(pool, queued.jobId);
    const future = new Date(NOW.getTime() + LEASE_MS + 1);
    await jobs.reclaimExpiredLeases({ now: future, limit: 10 });
    const snapshot = await jobs.findJobById(queued.jobId);
    assert.equal(snapshot?.status, 'permanent_failed');
    assert.equal(snapshot?.lastErrorCode, 'INGESTION_RETRY_EXHAUSTED');
    assert.equal(await jobs.claimNextJob({ workerId: 'worker-b', now: future, leaseMs: LEASE_MS }), undefined);
  });

  await t.test('synthetic production pipeline persists and completes without retrieval activation', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    const queued = await jobs.enqueueVerifiedJob(input(), NOW);
    const claim = await jobs.claimNextJob({ workerId: 'worker-a', now: NOW, leaseMs: LEASE_MS });
    assert.ok(claim);
    const worker = new FilingIngestionWorker(workerConfig, {
      jobs, acquisition: { async acquire() { return syntheticArchive(); } },
      persistence: new FilingDocumentRepository(pool), now: () => NOW,
    });
    assert.equal((await worker.processJob(claim)).status, 'succeeded');
    const snapshot = await jobs.findJobById(queued.jobId);
    assert.equal(snapshot?.status, 'succeeded');
    assert.equal((await jobs.enqueueVerifiedJob(input(), NOW)).status, 'already_succeeded');
    const document = await pool.query<{ is_retrieval_ready: boolean; is_current_effective: boolean; activated_at: Date | null }>(
      'SELECT is_retrieval_ready, is_current_effective, activated_at FROM filing_intelligence.filing_document WHERE id = $1',
      [snapshot?.persistedDocumentId],
    );
    assert.deepEqual(document.rows[0], { is_retrieval_ready: false, is_current_effective: false, activated_at: null });
  });

  await t.test('retryable acquisition failure records retry state without persistence', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    const queued = await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000012' }), NOW);
    const claim = await jobs.claimNextJob({ workerId: 'worker-a', now: NOW, leaseMs: LEASE_MS });
    assert.ok(claim);
    let persisted = 0;
    const worker = new FilingIngestionWorker(workerConfig, {
      jobs, acquisition: { async acquire() {
        throw new OpenDartError('OPENDART_RATE_LIMITED', 'filing-document', true);
      } },
      persistence: { async persistCanonicalFiling() { persisted += 1; throw new Error('unreachable'); } },
      now: () => NOW,
    });
    const result = await worker.processJob(claim);
    assert.equal(result.status, 'failed');
    assert.equal(persisted, 0);
    assert.equal((await jobs.findJobById(queued.jobId))?.status, 'retryable_failed');
    assert.deepEqual((await jobs.findAttempts(queued.jobId)).map(value => value.outcome), ['retryable_failed']);
  });

  await t.test('malformed XML records permanent failure without persistence', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    const queued = await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000013' }), NOW);
    const claim = await jobs.claimNextJob({ workerId: 'worker-a', now: NOW, leaseMs: LEASE_MS });
    assert.ok(claim);
    let persisted = 0;
    const worker = new FilingIngestionWorker(workerConfig, {
      jobs, acquisition: { async acquire() { return malformedArchive(claim.receiptNumber); } },
      persistence: { async persistCanonicalFiling() { persisted += 1; throw new Error('unreachable'); } },
      now: () => NOW,
    });
    assert.equal((await worker.processJob(claim)).status, 'failed');
    assert.equal(persisted, 0);
    assert.equal((await jobs.findJobById(queued.jobId))?.status, 'permanent_failed');
    assert.deepEqual((await jobs.findAttempts(queued.jobId)).map(value => value.outcome), ['permanent_failed']);
  });

  await t.test('persistence conflict records quarantine atomically', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    const queued = await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000014' }), NOW);
    const claim = await jobs.claimNextJob({ workerId: 'worker-a', now: NOW, leaseMs: LEASE_MS });
    assert.ok(claim);
    const worker = new FilingIngestionWorker(workerConfig, {
      jobs, acquisition: { async acquire() { return syntheticArchive(5, claim.receiptNumber); } },
      persistence: { async persistCanonicalFiling() {
        throw new FilingPersistenceError('FILING_PERSISTENCE_CONFLICT', false);
      } }, now: () => NOW,
    });
    assert.equal((await worker.processJob(claim)).status, 'failed');
    assert.equal((await jobs.findJobById(queued.jobId))?.status, 'quarantined');
    assert.deepEqual((await jobs.findAttempts(queued.jobId)).map(value => value.outcome), ['quarantined']);
  });

  await t.test('database lease loss before persistence prevents canonical writes', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    const queued = await jobs.enqueueVerifiedJob(input({ receiptNumber: '20990101000015' }), NOW);
    const claim = await jobs.claimNextJob({ workerId: 'worker-a', now: NOW, leaseMs: LEASE_MS });
    assert.ok(claim);
    let persisted = 0;
    const worker = new FilingIngestionWorker(workerConfig, {
      jobs, acquisition: { async acquire() {
        await expireLease(pool, queued.jobId);
        return syntheticArchive(5, claim.receiptNumber);
      } },
      persistence: { async persistCanonicalFiling() { persisted += 1; throw new Error('unreachable'); } },
      now: () => NOW,
    });
    assert.deepEqual(await worker.processJob(claim), { status: 'lease_lost' });
    assert.equal(persisted, 0);
    const documents = await pool.query<{ count: string }>('SELECT count(*) FROM filing_intelligence.filing_document');
    assert.equal(documents.rows[0]?.count, '0');
  });

  await t.test('crash after persistence recovers through already-present without duplicates', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    const queued = await jobs.enqueueVerifiedJob(input(), NOW);
    const firstClaim = await jobs.claimNextJob({ workerId: 'worker-a', now: NOW, leaseMs: LEASE_MS });
    assert.ok(firstClaim);
    let firstWorker: FilingIngestionWorker;
    firstWorker = new FilingIngestionWorker(workerConfig, {
      jobs, acquisition: { async acquire() { return syntheticArchive(); } },
      persistence: new FilingDocumentRepository(pool), now: () => NOW,
      afterPersist: async () => { firstWorker.requestShutdown(); throw new Error('simulated crash'); },
    });
    assert.deepEqual(await firstWorker.processJob(firstClaim), { status: 'interrupted' });
    const future = new Date(NOW.getTime() + LEASE_MS + 1);
    await expireLease(pool, queued.jobId);
    await jobs.reclaimExpiredLeases({ now: future, limit: 10 });
    await makeAvailable(pool, queued.jobId);
    const secondClaim = await jobs.claimNextJob({ workerId: 'worker-b', now: new Date(future.getTime() + 10_000), leaseMs: LEASE_MS });
    assert.ok(secondClaim);
    const secondWorker = new FilingIngestionWorker(workerConfig, {
      jobs, acquisition: { async acquire() { return syntheticArchive(); } },
      persistence: new FilingDocumentRepository(pool), now: () => new Date(future.getTime() + 10_000),
    });
    assert.deepEqual(await secondWorker.processJob(secondClaim), { status: 'succeeded', persistence: 'already_present' });
    assert.equal((await jobs.findJobById(queued.jobId))?.status, 'succeeded');
    const documents = await pool.query<{ count: string }>('SELECT count(*) FROM filing_intelligence.filing_document');
    assert.equal(documents.rows[0]?.count, '1');
    assert.deepEqual((await jobs.findAttempts(queued.jobId)).map(value => value.outcome), ['lease_expired', 'succeeded']);
  });

  await t.test('100-job smoke has no duplicate claims with two claimers', async () => {
    await clearPersistence(pool);
    const jobs = repository(pool);
    for (let index = 1; index <= 100; index += 1) {
      await jobs.enqueueVerifiedJob(input({
        receiptNumber: String(20_990_102_000_000 + index),
        priority: index % 5,
      }), NOW);
    }
    const claimedIds = new Set<string>();
    const started = performance.now();
    while (true) {
      const pair = await Promise.all([
        jobs.claimNextJob({ workerId: 'worker-a', now: NOW, leaseMs: LEASE_MS }),
        jobs.claimNextJob({ workerId: 'worker-b', now: NOW, leaseMs: LEASE_MS }),
      ]);
      const present = pair.filter(value => value != null);
      for (const value of present) {
        assert.equal(claimedIds.has(value.id), false);
        claimedIds.add(value.id);
      }
      if (present.length === 0) break;
    }
    const elapsedMs = performance.now() - started;
    assert.equal(claimedIds.size, 100);
    assert.ok(elapsedMs >= 0);
  });
});
