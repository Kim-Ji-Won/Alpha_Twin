import assert from 'node:assert/strict';
import test from 'node:test';

import { DenseGenerationWorker, DenseJobStore } from '../src/filingIntelligence/dense/denseGenerationWorker.js';
import { ClaimedDenseJob, DenseAttemptMetrics, PreparedDenseJob } from '../src/filingIntelligence/dense/denseGenerationJobRepository.js';
import { DenseGenerationError, EmbeddingProvider, SafeDenseFailure } from '../src/filingIntelligence/dense/embeddingProvider.js';
import { FILING_DENSE_PROFILES } from '../src/filingIntelligence/dense/profile.js';

const profile = FILING_DENSE_PROFILES.openAiSmall1536;
const vector = (seed: number) => Array.from({ length: 1536 }, (_, index) => ((index + seed) % 19 + 1) / 100);
const job: ClaimedDenseJob = { id: '1', generationId: '2', documentId: '3', denseProfileId: profile.profileId,
  attemptNumber: 1, maxAttempts: 5, workerId: 'worker', leaseToken: 'token' };
const chunks = [1, 2, 3].map(index => ({ chunkRowId: String(index), chunkId: `chunk-${index}`, ordinal: index,
  contentHash: 'a'.repeat(64), retrievalText: `문장 ${index}`, inputFingerprint: 'b'.repeat(64) }));
const prepared: PreparedDenseJob = { generation: { generationId: '2', documentId: '3', denseProfileId: profile.profileId,
  status: 'building', expectedVectorCount: 3, persistedVectorCount: 1, inputManifestFingerprint: 'c'.repeat(64) },
chunks, missingChunks: chunks.slice(1) };
const config = { workerId: 'worker', concurrency: 1, pollIntervalMs: 100, leaseMs: 30_000,
  heartbeatMs: 10_000, shutdownGraceMs: 1_000, reclaimBatchSize: 20 };

class FakeJobs implements DenseJobStore {
  readonly batches: string[][] = [];
  completed?: DenseAttemptMetrics;
  failed?: SafeDenseFailure;
  constructor(readonly value: PreparedDenseJob | { ready: true } = prepared) {}
  async reclaimExpired() { return 0; }
  async claimNext() { return undefined; }
  async heartbeat() { return { status: 'updated' as const }; }
  async prepare() { return this.value; }
  async persistBatch(_job: ClaimedDenseJob, values: readonly { chunkRowId: string }[]) {
    this.batches.push(values.map(value => value.chunkRowId)); return { status: 'updated' as const };
  }
  async complete(_job: ClaimedDenseJob, metrics: DenseAttemptMetrics) {
    this.completed = metrics; return { status: 'updated' as const };
  }
  async fail(_job: ClaimedDenseJob, failure: SafeDenseFailure) {
    this.failed = failure; return { status: 'updated' as const };
  }
}

function worker(jobs: FakeJobs, provider: EmbeddingProvider) {
  return new DenseGenerationWorker(config, { jobs, provider, tokenizer: { count: text => text.length },
    monotonicNow: () => 1, sleep: async (_ms, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }) });
}

test('dense worker resumes only missing vectors and succeeds after verified finalize', async () => {
  const jobs = new FakeJobs(); const requested: string[][] = [];
  const provider: EmbeddingProvider = { async embedBatch(_profile, inputs) {
    requested.push(inputs.map(value => value.inputId)); return { provider: 'openai', model: profile.modelId,
      vectors: inputs.map((value, index) => ({ inputId: value.inputId, vector: vector(index + 1) })), tokenCount: 9 };
  } };
  assert.deepEqual(await worker(jobs, provider).processJob(job), { status: 'succeeded' });
  assert.deepEqual(requested, [['2', '3']]); assert.deepEqual(jobs.batches, [['2', '3']]);
  assert.equal(jobs.completed?.requestCount, 1); assert.equal(jobs.completed?.vectorCount, 2);
});

test('ready generation completes without provider invocation', async () => {
  const jobs = new FakeJobs({ ready: true }); let calls = 0;
  const provider: EmbeddingProvider = { async embedBatch() { calls += 1; throw new Error('unexpected'); } };
  assert.deepEqual(await worker(jobs, provider).processJob(job), { status: 'succeeded' });
  assert.equal(calls, 0); assert.equal(jobs.completed?.requestCount, 0);
});

test('worker accepts the requested model dated snapshot provenance', async () => {
  const jobs = new FakeJobs();
  const provider: EmbeddingProvider = { async embedBatch(_profile, inputs) {
    return { provider: 'openai', model: `${profile.modelId}-2024-01-25`, tokenCount: 1,
      vectors: inputs.map((value, index) => ({ inputId: value.inputId, vector: vector(index + 1) })) };
  } };
  assert.deepEqual(await worker(jobs, provider).processJob(job), { status: 'succeeded' });
});

test('whole-document cost failure happens before provider invocation', async () => {
  const tooManyTokens = new FakeJobs({ ...prepared, missingChunks: chunks }); let calls = 0;
  const provider: EmbeddingProvider = { async embedBatch() { calls += 1; throw new Error('unexpected'); } };
  const instance = new DenseGenerationWorker(config, { jobs: tooManyTokens, provider,
    tokenizer: { count: () => 100_000 }, monotonicNow: () => 1,
    sleep: async (_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  assert.deepEqual(await instance.processJob(job), { status: 'failed' });
  assert.equal(calls, 0); assert.equal(tooManyTokens.failed?.code, 'DENSE_INPUT_LIMIT_EXCEEDED');
});

test('provider failure is reduced to bounded safe taxonomy', async () => {
  const jobs = new FakeJobs();
  const provider: EmbeddingProvider = { async embedBatch() {
    throw new DenseGenerationError('DENSE_PROVIDER_UNAVAILABLE', true, 2_000, '5xx');
  } };
  assert.deepEqual(await worker(jobs, provider).processJob(job), { status: 'failed' });
  assert.deepEqual(jobs.failed, { code: 'DENSE_PROVIDER_UNAVAILABLE', retryable: true,
    category: 'retryable', retryAfterMs: 2_000, providerStatusClass: '5xx' });
});

test('worker independently rejects a provider implementation with duplicate output identity', async () => {
  const jobs = new FakeJobs();
  const provider: EmbeddingProvider = { async embedBatch(_profile, inputs) {
    return { provider: 'openai', model: profile.modelId, tokenCount: 1,
      vectors: inputs.map(() => ({ inputId: inputs[0]!.inputId, vector: vector(1) })) };
  } };
  assert.deepEqual(await worker(jobs, provider).processJob(job), { status: 'failed' });
  assert.equal(jobs.batches.length, 0);
  assert.equal(jobs.failed?.code, 'DENSE_PROVIDER_RESPONSE_INVALID');
});
