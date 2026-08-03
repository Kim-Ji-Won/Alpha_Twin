import { DatabaseError } from '../../infrastructure/database/errors.js';
import { FilingPersistenceError } from '../persistence/errors.js';
import { isOpenDartError } from '../../openDart/errors.js';
import { SafeIngestionFailure } from './contracts.js';
import { IngestionError } from './errors.js';

const QUARANTINE_DART_CODES = new Set([
  'OPENDART_DOCUMENT_UNSAFE_ARCHIVE',
  'OPENDART_DOCUMENT_UNSAFE_XML',
  'OPENDART_DOCUMENT_XML_TOO_COMPLEX',
]);

export interface RetryPolicy {
  readonly baseDelayMs: number;
  readonly maximumDelayMs: number;
  readonly jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseDelayMs: 5_000,
  maximumDelayMs: 15 * 60_000,
  jitterRatio: 0.2,
};

export function classifyIngestionFailure(error: unknown): SafeIngestionFailure {
  if (error instanceof IngestionError) {
    if (error.code === 'INGESTION_SOURCE_IDENTITY_MISMATCH') {
      return { code: error.code, category: 'quarantine', retryable: false };
    }
    return { code: error.code, category: error.retryable ? 'retryable' : 'permanent', retryable: error.retryable };
  }
  if (isOpenDartError(error)) {
    if (QUARANTINE_DART_CODES.has(error.code)) {
      return { code: error.code, category: 'quarantine', retryable: false };
    }
    return {
      code: error.code,
      category: error.retryable ? 'retryable' : 'permanent',
      retryable: error.retryable,
    };
  }
  if (error instanceof FilingPersistenceError) {
    if (error.code === 'FILING_PERSISTENCE_CONFLICT' || error.code === 'FILING_PERSISTENCE_INTEGRITY_FAILURE') {
      return { code: error.code, category: 'quarantine', retryable: false };
    }
    return { code: error.code, category: error.retryable ? 'retryable' : 'permanent', retryable: error.retryable };
  }
  if (error instanceof DatabaseError) {
    return { code: error.code, category: error.retryable ? 'retryable' : 'permanent', retryable: error.retryable };
  }
  return { code: 'INGESTION_UNCLASSIFIED_FAILURE', category: 'quarantine', retryable: false };
}

export function retryDelayMs(
  attemptNumber: number,
  random: () => number,
  retryAfterMs: number | undefined,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number {
  const exponential = Math.min(
    policy.maximumDelayMs,
    policy.baseDelayMs * 2 ** Math.max(0, attemptNumber - 1),
  );
  const boundedRetryAfter = retryAfterMs == null
    ? 0
    : Math.max(0, Math.min(policy.maximumDelayMs, retryAfterMs));
  const base = Math.max(exponential, boundedRetryAfter);
  const boundedRandom = Math.max(0, Math.min(1, random()));
  const jitter = Math.floor(base * policy.jitterRatio * boundedRandom);
  return Math.min(policy.maximumDelayMs, base + jitter);
}
