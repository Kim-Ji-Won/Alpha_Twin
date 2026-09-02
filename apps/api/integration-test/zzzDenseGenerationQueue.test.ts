import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';

import { DenseGenerationJobRepository } from '../src/filingIntelligence/dense/denseGenerationJobRepository.js';
import { DenseGenerationWorker } from '../src/filingIntelligence/dense/denseGenerationWorker.js';
import { DenseGenerationError, EmbeddingProvider } from '../src/filingIntelligence/dense/embeddingProvider.js';
import { FilingDenseRepository } from '../src/filingIntelligence/dense/filingDenseRepository.js';
import { FILING_DENSE_PROFILES } from '../src/filingIntelligence/dense/profile.js';
import { FilingDocumentRepository } from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { clearPersistence, requiredTestDatabaseUrl, runMigrations } from './helpers/database.js';
import { syntheticPersistenceInputFor } from './helpers/filingFixture.js';

const profile = FILING_DENSE_PROFILES.openAiSmall1536;
const vector = (seed: number) => Array.from({ length: 1536 }, (_, index) => ((index + seed) % 23 + 1) / 100);
const config = { workerId: 'worker', concurrency: 1, pollIntervalMs: 100, leaseMs: 30_000,
  heartbeatMs: 10_000, shutdownGraceMs: 1_000, reclaimBatchSize: 20 };
const metrics = { requestCount: 0, inputCount: 0, vectorCount: 0, tokenCount: 0, utf8Bytes: 0, durationMs: 0 };

function provider(calls: string[][]): EmbeddingProvider {
  return { async embedBatch(_profile, inputs) {
    calls.push(inputs.map(input => input.inputId));
    return { provider: 'openai', model: profile.modelId, tokenCount: inputs.length,
      vectors: inputs.map((input, index) => ({ inputId: input.inputId, vector: vector(index + calls.length) })) };
  } };
}

async function document(pool: Pool, receipt: string, paragraphs = ['첫 번째 문장', '두 번째 문장', '세 번째 문장']) {
  return new FilingDocumentRepository(pool).persistCanonicalFiling(syntheticPersistenceInputFor({
    receiptNumber: receipt, corpCode: '11111111', symbol: '111111', paragraphTexts: paragraphs,
  }));
}

test('dense generation queue PostgreSQL lifecycle', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl, max: 8, statement_timeout: 30_000 });
  t.after(async () => pool.end());
  await runMigrations('up', databaseUrl, true);

  await t.test('migration up is a no-op and down/re-up preserves E-B vector tables', async () => {
    await runMigrations('up', databaseUrl, true);
    await runMigrations('down', databaseUrl, true);
    const afterDown = await pool.query<{ queue: string | null; generation: string | null }>(
      `SELECT to_regclass('filing_intelligence.filing_dense_generation_job')::text queue,
         to_regclass('filing_intelligence.filing_dense_generation')::text generation`,
    );
    assert.deepEqual(afterDown.rows[0], { queue: null, generation: 'filing_intelligence.filing_dense_generation' });
    await runMigrations('up', databaseUrl, true);
  });

  await t.test('migration creates bounded queue relations without extension ownership', async () => {
    const result = await pool.query<{ job: string | null; attempt: string | null; vector_version: string }>(
      `SELECT to_regclass('filing_intelligence.filing_dense_generation_job')::text job,
         to_regclass('filing_intelligence.filing_dense_generation_attempt')::text attempt,
         (SELECT extversion FROM pg_extension WHERE extname='vector') vector_version`,
    );
    assert.equal(result.rows[0]!.job, 'filing_intelligence.filing_dense_generation_job');
    assert.equal(result.rows[0]!.attempt, 'filing_intelligence.filing_dense_generation_attempt');
    assert.match(result.rows[0]!.vector_version, /^0\.8\./);
  });

  await t.test('enqueue is idempotent and concurrent claims select one worker', async () => {
    await clearPersistence(pool);
    const persisted = await document(pool, '20990101001001');
    const jobs = new DenseGenerationJobRepository(pool);
    const first = await jobs.enqueue(persisted.documentId, profile.profileId);
    const duplicate = await jobs.enqueue(persisted.documentId, profile.profileId);
    assert.equal(first.status, 'enqueued'); assert.equal(duplicate.status, 'already_enqueued');
    assert.equal(first.jobId, duplicate.jobId); assert.equal(first.generationId, duplicate.generationId);
    const claims = await Promise.all([jobs.claimNext('worker-a', 30_000), jobs.claimNext('worker-b', 30_000)]);
    assert.equal(claims.filter(Boolean).length, 1);
  });

  await t.test('expired W1 lease fences every late mutation and W2 completes exact evidence', async () => {
    await clearPersistence(pool);
    const persisted = await document(pool, '20990101001002');
    const jobs = new DenseGenerationJobRepository(pool, undefined, () => 0);
    const enqueued = await jobs.enqueue(persisted.documentId, profile.profileId);
    const w1 = (await jobs.claimNext('worker-1', 30_000))!;
    const prepared = await jobs.prepare(w1); assert.ok(!('ready' in prepared));
    await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
      SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [w1.id]);
    assert.equal(await jobs.reclaimExpired(20), 1);
    await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
      SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [w1.id]);
    const w2 = (await jobs.claimNext('worker-2', 30_000))!;
    assert.notEqual(w1.leaseToken, w2.leaseToken);
    assert.equal((await jobs.heartbeat(w1.id, w1.leaseToken, 30_000)).status, 'lease_lost');
    assert.equal((await jobs.persistBatch(w1, [{ ...prepared.chunks[0]!, vector: vector(99) }])).status, 'lease_lost');
    assert.equal((await jobs.complete(w1, metrics)).status, 'lease_lost');
    assert.equal((await jobs.fail(w1, { code: 'DENSE_PROVIDER_UNAVAILABLE', retryable: true,
      category: 'retryable' }, metrics)).status, 'lease_lost');
    const calls: string[][] = [];
    const result = await new DenseGenerationWorker(config, { jobs, provider: provider(calls),
      tokenizer: { count: text => text.length }, monotonicNow: () => 1,
      sleep: async (_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) })
      .processJob(w2);
    assert.deepEqual(result, { status: 'succeeded' }); assert.equal(calls.flat().length, prepared.chunks.length);
    const state = await pool.query<{ job_status: string; generation_status: string; count: number }>(
      `SELECT j.status job_status,g.status generation_status,
         (SELECT count(*)::integer FROM filing_intelligence.filing_chunk_embedding e WHERE e.generation_id=g.id) count
       FROM filing_intelligence.filing_dense_generation_job j
       JOIN filing_intelligence.filing_dense_generation g ON g.id=j.generation_id WHERE j.id=$1`, [enqueued.jobId],
    );
    assert.deepEqual(state.rows[0], { job_status: 'succeeded', generation_status: 'ready', count: prepared.chunks.length });
  });

  await t.test('partial generation resumes only missing exact input fingerprints', async () => {
    await clearPersistence(pool);
    const persisted = await document(pool, '20990101001003');
    const jobs = new DenseGenerationJobRepository(pool, undefined, () => 0);
    await jobs.enqueue(persisted.documentId, profile.profileId);
    const w1 = (await jobs.claimNext('worker-1', 30_000))!;
    const prepared = await jobs.prepare(w1); assert.ok(!('ready' in prepared));
    const first = prepared.chunks[0]!;
    assert.equal((await jobs.persistBatch(w1, [{ ...first, vector: vector(1) }])).status, 'updated');
    await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
      SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [w1.id]);
    await jobs.reclaimExpired(20);
    await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
      SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [w1.id]);
    const w2 = (await jobs.claimNext('worker-2', 30_000))!;
    const calls: string[][] = [];
    assert.deepEqual(await new DenseGenerationWorker(config, { jobs, provider: provider(calls),
      tokenizer: { count: text => text.length }, monotonicNow: () => 1,
      sleep: async (_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) })
      .processJob(w2), { status: 'succeeded' });
    assert.equal(calls.flat().includes(first.chunkRowId), false);
    assert.equal(calls.flat().length, prepared.chunks.length - 1);
  });

  await t.test('partial resume rejects stored vector payload or fingerprint drift', async () => {
    await clearPersistence(pool);
    const persisted = await document(pool, '20990101001011');
    const jobs = new DenseGenerationJobRepository(pool);
    await jobs.enqueue(persisted.documentId, profile.profileId);
    const claimed = (await jobs.claimNext('integrity-1', 30_000))!;
    const prepared = await jobs.prepare(claimed); assert.ok(!('ready' in prepared));
    await jobs.persistBatch(claimed, [{ ...prepared.chunks[0]!, vector: vector(1) }]);
    await pool.query(
      `UPDATE filing_intelligence.filing_chunk_embedding
       SET embedding=embedding+embedding WHERE generation_id=$1`,
      [claimed.generationId],
    );
    await assert.rejects(jobs.prepare(claimed), value => value instanceof DenseGenerationError
      && value.code === 'DENSE_GENERATION_CONFLICT');
  });

  await t.test('crash after finalize converges the reclaimed job with zero provider calls', async () => {
    await clearPersistence(pool);
    const persisted = await document(pool, '20990101001004');
    const jobs = new DenseGenerationJobRepository(pool);
    const queued = await jobs.enqueue(persisted.documentId, profile.profileId);
    const crashed = (await jobs.claimNext('finalize-crash', 30_000))!;
    const dense = new FilingDenseRepository(pool);
    const current = await dense.createGeneration(persisted.documentId, profile.profileId);
    await dense.persistVectorBatch(current.generation.generationId,
      current.chunks.map((chunk, index) => ({ ...chunk, vector: vector(index + 1) })));
    const finalized = await dense.finalizeGeneration(current.generation.generationId);
    const readyBefore = await pool.query<{ ready_at: string; generation_fingerprint: string }>(
      `SELECT ready_at::text,generation_fingerprint
       FROM filing_intelligence.filing_dense_generation WHERE id=$1`, [finalized.generationId]);
    await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
      SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [crashed.id]);
    await jobs.reclaimExpired(20);
    await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
      SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [crashed.id]);
    const claimed = (await jobs.claimNext('worker-ready', 30_000))!;
    const calls: string[][] = [];
    assert.deepEqual(await new DenseGenerationWorker(config, { jobs, provider: provider(calls),
      tokenizer: { count: text => text.length }, monotonicNow: () => 1,
      sleep: async (_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) })
      .processJob(claimed), { status: 'succeeded' });
    assert.equal(calls.length, 0);
    const status = await pool.query<{ status: string }>(
      'SELECT status FROM filing_intelligence.filing_dense_generation_job WHERE id=$1', [queued.jobId]);
    assert.equal(status.rows[0]!.status, 'succeeded');
    const readyAfter = await pool.query<{ ready_at: string; generation_fingerprint: string }>(
      `SELECT ready_at::text,generation_fingerprint
       FROM filing_intelligence.filing_dense_generation WHERE id=$1`, [finalized.generationId]);
    assert.deepEqual(readyAfter.rows[0], readyBefore.rows[0]);
  });

  await t.test('permanent failure retains partial vectors and fails generation without raw data', async () => {
    await clearPersistence(pool);
    const persisted = await document(pool, '20990101001005');
    const jobs = new DenseGenerationJobRepository(pool);
    await jobs.enqueue(persisted.documentId, profile.profileId);
    const claimed = (await jobs.claimNext('worker-fail', 30_000))!;
    const prepared = await jobs.prepare(claimed); assert.ok(!('ready' in prepared));
    await jobs.persistBatch(claimed, [{ ...prepared.chunks[0]!, vector: vector(1) }]);
    await jobs.fail(claimed, { code: 'DENSE_PROVIDER_RESPONSE_INVALID', retryable: false,
      category: 'permanent', providerStatusClass: '4xx' }, metrics);
    const result = await pool.query<{ job_status: string; generation_status: string;
      failure_code: string; count: number }>(
      `SELECT j.status job_status,g.status generation_status,g.failure_code,
         (SELECT count(*)::integer FROM filing_intelligence.filing_chunk_embedding e WHERE e.generation_id=g.id) count
       FROM filing_intelligence.filing_dense_generation_job j
       JOIN filing_intelligence.filing_dense_generation g ON g.id=j.generation_id WHERE j.id=$1`, [claimed.id],
    );
    assert.deepEqual(result.rows[0], { job_status: 'failed', generation_status: 'failed',
      failure_code: 'DENSE_PROVIDER_RESPONSE_INVALID', count: 1 });
  });

  await t.test('inactive document generates both candidate profiles independently without a winner', async () => {
    await clearPersistence(pool);
    const persisted = await document(pool, '20990101001006');
    const activation = await pool.query<{ count: number }>(
      'SELECT count(*)::integer count FROM filing_intelligence.filing_retrieval_activation');
    assert.equal(activation.rows[0]!.count, 0);
    const jobs = new DenseGenerationJobRepository(pool);
    for (const candidate of Object.values(FILING_DENSE_PROFILES)) {
      await jobs.enqueue(persisted.documentId, candidate.profileId);
    }
    const models: string[] = [];
    const multiProvider: EmbeddingProvider = { async embedBatch(candidate, inputs) {
      models.push(candidate.modelId);
      return { provider: 'openai', model: candidate.modelId, tokenCount: inputs.length,
        vectors: inputs.map((input, index) => ({ inputId: input.inputId, vector: vector(index + 1) })) };
    } };
    for (let index = 0; index < 2; index += 1) {
      const claimed = (await jobs.claimNext(`multi-${index}`, 30_000))!;
      assert.deepEqual(await new DenseGenerationWorker(config, { jobs, provider: multiProvider,
        tokenizer: { count: text => text.length }, monotonicNow: () => 1,
        sleep: async (_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) })
        .processJob(claimed), { status: 'succeeded' });
    }
    assert.deepEqual(new Set(models), new Set(['text-embedding-3-small', 'text-embedding-3-large']));
    const ready = await pool.query<{ count: number }>(
      "SELECT count(*)::integer count FROM filing_intelligence.filing_dense_generation WHERE document_id=$1 AND status='ready'",
      [persisted.documentId]);
    assert.equal(ready.rows[0]!.count, 2);
  });

  await t.test('429 retry then success records two attempts and one final vector set', async () => {
    await clearPersistence(pool);
    const persisted = await document(pool, '20990101001007');
    const jobs = new DenseGenerationJobRepository(pool, undefined, () => 0);
    await jobs.enqueue(persisted.documentId, profile.profileId);
    const first = (await jobs.claimNext('retry-1', 30_000))!;
    await jobs.fail(first, { code: 'DENSE_PROVIDER_RATE_LIMITED', retryable: true,
      category: 'retryable', retryAfterMs: 1_000, providerStatusClass: '4xx' }, metrics);
    const retryState = await pool.query<{ job: string; generation: string; completed_at: string | null }>(
      `SELECT j.status job,g.status generation,j.completed_at::text
       FROM filing_intelligence.filing_dense_generation_job j
       JOIN filing_intelligence.filing_dense_generation g ON g.id=j.generation_id WHERE j.id=$1`, [first.id]);
    assert.deepEqual(retryState.rows[0], { job: 'retry_wait', generation: 'building', completed_at: null });
    await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
      SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [first.id]);
    const second = (await jobs.claimNext('retry-2', 30_000))!;
    const calls: string[][] = [];
    assert.deepEqual(await new DenseGenerationWorker(config, { jobs, provider: provider(calls),
      tokenizer: { count: text => text.length }, monotonicNow: () => 1,
      sleep: async (_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) })
      .processJob(second), { status: 'succeeded' });
    const attempts = await pool.query<{ outcome: string }>(
      'SELECT outcome FROM filing_intelligence.filing_dense_generation_attempt WHERE job_id=$1 ORDER BY attempt_number',
      [first.id]);
    assert.deepEqual(attempts.rows.map(row => row.outcome), ['retryable_failed', 'succeeded']);
  });

  await t.test('retry exhaustion bounds provider calls and fails both job and generation', async () => {
    await clearPersistence(pool);
    const persisted = await document(pool, '20990101001008');
    const jobs = new DenseGenerationJobRepository(pool, undefined, () => 0);
    const enqueued = await jobs.enqueue(persisted.documentId, profile.profileId);
    await pool.query('UPDATE filing_intelligence.filing_dense_generation_job SET max_attempts=2 WHERE id=$1', [enqueued.jobId]);
    let calls = 0;
    const unavailable: EmbeddingProvider = { async embedBatch() {
      calls += 1; throw new DenseGenerationError('DENSE_PROVIDER_TIMEOUT', true);
    } };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
        SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [enqueued.jobId]);
      const claimed = (await jobs.claimNext(`exhaust-${attempt}`, 30_000))!;
      assert.deepEqual(await new DenseGenerationWorker(config, { jobs, provider: unavailable,
        tokenizer: { count: text => text.length }, monotonicNow: () => 1,
        sleep: async (_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) })
        .processJob(claimed), { status: 'failed' });
    }
    assert.equal(calls, 2);
    const state = await pool.query<{ job: string; generation: string; code: string }>(
      `SELECT j.status job,g.status generation,g.failure_code code
       FROM filing_intelligence.filing_dense_generation_job j
       JOIN filing_intelligence.filing_dense_generation g ON g.id=j.generation_id WHERE j.id=$1`, [enqueued.jobId]);
    assert.deepEqual(state.rows[0], { job: 'failed', generation: 'failed', code: 'DENSE_RETRY_EXHAUSTED' });
    assert.equal(await jobs.claimNext('exhaust-never', 30_000), undefined);
  });

  await t.test('crash after all vectors persists resumes with zero provider calls and finalizes', async () => {
    await clearPersistence(pool);
    const persisted = await document(pool, '20990101001009');
    const jobs = new DenseGenerationJobRepository(pool, undefined, () => 0);
    await jobs.enqueue(persisted.documentId, profile.profileId);
    const w1 = (await jobs.claimNext('persist-crash', 30_000))!;
    const prepared = await jobs.prepare(w1); assert.ok(!('ready' in prepared));
    await jobs.persistBatch(w1, prepared.chunks.map((chunk, index) => ({ ...chunk, vector: vector(index + 1) })));
    await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
      SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [w1.id]);
    await jobs.reclaimExpired(20);
    await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
      SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [w1.id]);
    const w2 = (await jobs.claimNext('persist-recover', 30_000))!; const calls: string[][] = [];
    assert.deepEqual(await new DenseGenerationWorker(config, { jobs, provider: provider(calls),
      tokenizer: { count: text => text.length }, monotonicNow: () => 1,
      sleep: async (_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) })
      .processJob(w2), { status: 'succeeded' });
    assert.equal(calls.length, 0);
  });

  await t.test('late fake-provider response after W2 completion is fenced to zero writes', async () => {
    await clearPersistence(pool);
    const persisted = await document(pool, '20990101001010');
    const jobs = new DenseGenerationJobRepository(pool, undefined, () => 0);
    await jobs.enqueue(persisted.documentId, profile.profileId);
    const w1 = (await jobs.claimNext('late-1', 30_000))!;
    let release!: () => void; let started!: () => void;
    const providerStarted = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const lateProvider: EmbeddingProvider = { async embedBatch(_profile, inputs) {
      started(); await gate; return { provider: 'openai', model: profile.modelId, tokenCount: inputs.length,
        vectors: inputs.map((input, index) => ({ inputId: input.inputId, vector: vector(index + 50) })) };
    } };
    const lateWorker = new DenseGenerationWorker(config, { jobs, provider: lateProvider,
      tokenizer: { count: text => text.length }, monotonicNow: () => 1,
      sleep: async (_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
    const lateResult = lateWorker.processJob(w1); await providerStarted;
    await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
      SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [w1.id]);
    await jobs.reclaimExpired(20);
    await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
      SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [w1.id]);
    const w2 = (await jobs.claimNext('late-2', 30_000))!; const w2Calls: string[][] = [];
    assert.deepEqual(await new DenseGenerationWorker(config, { jobs, provider: provider(w2Calls),
      tokenizer: { count: text => text.length }, monotonicNow: () => 1,
      sleep: async (_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) })
      .processJob(w2), { status: 'succeeded' });
    const before = await pool.query<{ evidence: unknown }>(
      `SELECT jsonb_agg(to_jsonb(e) ORDER BY e.chunk_row_id) evidence
       FROM filing_intelligence.filing_chunk_embedding e WHERE generation_id=$1`, [w1.generationId]);
    release(); assert.deepEqual(await lateResult, { status: 'lease_lost' });
    const after = await pool.query<{ evidence: unknown }>(
      `SELECT jsonb_agg(to_jsonb(e) ORDER BY e.chunk_row_id) evidence
       FROM filing_intelligence.filing_chunk_embedding e WHERE generation_id=$1`, [w1.generationId]);
    assert.deepEqual(after.rows[0]!.evidence, before.rows[0]!.evidence);
  });

  await t.test('late fake-provider failure after W2 completion is fenced to zero writes', async () => {
    await clearPersistence(pool);
    const persisted = await document(pool, '20990101001012');
    const jobs = new DenseGenerationJobRepository(pool, undefined, () => 0);
    await jobs.enqueue(persisted.documentId, profile.profileId);
    const w1 = (await jobs.claimNext('late-failure-1', 30_000))!;
    let rejectLate!: (reason: DenseGenerationError) => void; let started!: () => void;
    const providerStarted = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<never>((_resolve, reject) => { rejectLate = reject; });
    const lateProvider: EmbeddingProvider = { async embedBatch() { started(); return gate; } };
    const lateWorker = new DenseGenerationWorker(config, { jobs, provider: lateProvider,
      tokenizer: { count: text => text.length }, monotonicNow: () => 1,
      sleep: async (_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
    const lateResult = lateWorker.processJob(w1); await providerStarted;
    await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
      SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [w1.id]);
    await jobs.reclaimExpired(20);
    await pool.query(`UPDATE filing_intelligence.filing_dense_generation_job
      SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1`, [w1.id]);
    const w2 = (await jobs.claimNext('late-failure-2', 30_000))!;
    assert.deepEqual(await new DenseGenerationWorker(config, { jobs, provider: provider([]),
      tokenizer: { count: text => text.length }, monotonicNow: () => 1,
      sleep: async (_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) })
      .processJob(w2), { status: 'succeeded' });
    const stateQuery = `SELECT jsonb_build_object(
      'job',to_jsonb(j),'generation',to_jsonb(g),
      'attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attempt_number)
        FROM filing_intelligence.filing_dense_generation_attempt a WHERE a.job_id=j.id),
      'evidence',(SELECT jsonb_agg(to_jsonb(e) ORDER BY e.chunk_row_id)
        FROM filing_intelligence.filing_chunk_embedding e WHERE e.generation_id=g.id)) state
      FROM filing_intelligence.filing_dense_generation_job j
      JOIN filing_intelligence.filing_dense_generation g ON g.id=j.generation_id WHERE j.id=$1`;
    const before = await pool.query<{ state: unknown }>(stateQuery, [w1.id]);
    rejectLate(new DenseGenerationError('DENSE_PROVIDER_TIMEOUT', true));
    assert.deepEqual(await lateResult, { status: 'lease_lost' });
    const after = await pool.query<{ state: unknown }>(stateQuery, [w1.id]);
    assert.deepEqual(after.rows[0]!.state, before.rows[0]!.state);
  });
});
