import { SafeDenseFailure } from './embeddingProvider.js';

export const DENSE_RETRY_POLICY = Object.freeze({
  baseDelayMs: 5_000,
  maximumDelayMs: 15 * 60_000,
  jitterRatio: 0.2,
});

export function denseRetryDelayMs(
  attemptNumber: number,
  random: () => number,
  retryAfterMs?: number,
): number {
  const exponential = Math.min(
    DENSE_RETRY_POLICY.maximumDelayMs,
    DENSE_RETRY_POLICY.baseDelayMs * 2 ** Math.max(0, attemptNumber - 1),
  );
  const providerDelay = retryAfterMs == null
    ? 0
    : Math.max(0, Math.min(DENSE_RETRY_POLICY.maximumDelayMs, retryAfterMs));
  const base = Math.max(exponential, providerDelay);
  const jitter = Math.floor(base * DENSE_RETRY_POLICY.jitterRatio
    * Math.max(0, Math.min(1, random())));
  return Math.min(DENSE_RETRY_POLICY.maximumDelayMs, base + jitter);
}

export function exhaustedFailure(failure: SafeDenseFailure): SafeDenseFailure {
  return failure.retryable
    ? { code: 'DENSE_RETRY_EXHAUSTED', retryable: false, category: 'permanent' }
    : failure;
}
