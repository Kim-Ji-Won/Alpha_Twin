import assert from 'node:assert/strict';
import test from 'node:test';

import { DENSE_RETRY_POLICY, denseRetryDelayMs,
  exhaustedFailure } from '../src/filingIntelligence/dense/denseRetryPolicy.js';
import { loadDenseWorkerConfig } from '../src/filingIntelligence/dense/denseWorkerConfig.js';

test('dense retry backoff is exponential, jittered, capped, and honors bounded Retry-After', () => {
  assert.equal(denseRetryDelayMs(1, () => 0), 5_000);
  assert.equal(denseRetryDelayMs(2, () => 0), 10_000);
  assert.equal(denseRetryDelayMs(1, () => 1), 6_000);
  assert.equal(denseRetryDelayMs(1, () => 0, 60_000), 60_000);
  assert.equal(denseRetryDelayMs(99, () => 1, 99_999_999), DENSE_RETRY_POLICY.maximumDelayMs);
  assert.deepEqual(exhaustedFailure({ code: 'DENSE_PROVIDER_RATE_LIMITED', retryable: true,
    category: 'retryable' }), { code: 'DENSE_RETRY_EXHAUSTED', retryable: false, category: 'permanent' });
});

test('dense worker defaults to one lane and rejects unsafe concurrency or heartbeat settings', () => {
  const config = loadDenseWorkerConfig({ DENSE_WORKER_ID: 'test-worker' });
  assert.equal(config.concurrency, 1); assert.equal(config.workerId, 'test-worker');
  assert.throws(() => loadDenseWorkerConfig({ DENSE_WORKER_CONCURRENCY: '5' }));
  assert.throws(() => loadDenseWorkerConfig({ DENSE_WORKER_LEASE_MS: '30000', DENSE_WORKER_HEARTBEAT_MS: '30000' }));
});
