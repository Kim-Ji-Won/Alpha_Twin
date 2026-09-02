import { FilingDenseProfile } from './profile.js';

export interface EmbeddingInput {
  readonly inputId: string;
  readonly text: string;
}

export interface EmbeddingVector {
  readonly inputId: string;
  readonly vector: readonly number[];
}

export interface EmbeddingBatchResult {
  readonly provider: 'openai';
  readonly model: string;
  readonly vectors: readonly EmbeddingVector[];
  readonly tokenCount: number;
}

export interface EmbeddingProvider {
  embedBatch(
    profile: FilingDenseProfile,
    inputs: readonly EmbeddingInput[],
    signal?: AbortSignal,
  ): Promise<EmbeddingBatchResult>;
}

export function isCompatibleEmbeddingResponseModel(requestedModel: string, responseModel: string): boolean {
  if (responseModel === requestedModel) return true;
  const escaped = requestedModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}-\\d{4}-\\d{2}-\\d{2}$`).test(responseModel);
}

export type DenseFailureCode =
  | 'DENSE_PROVIDER_NOT_CONFIGURED'
  | 'DENSE_PROVIDER_RATE_LIMITED'
  | 'DENSE_PROVIDER_TIMEOUT'
  | 'DENSE_PROVIDER_UNAVAILABLE'
  | 'DENSE_PROVIDER_INVALID_REQUEST'
  | 'DENSE_PROVIDER_RESPONSE_INVALID'
  | 'DENSE_INPUT_LIMIT_EXCEEDED'
  | 'DENSE_COST_LIMIT_EXCEEDED'
  | 'DENSE_PROFILE_DRIFT'
  | 'DENSE_GENERATION_CONFLICT'
  | 'DENSE_DATABASE_UNAVAILABLE'
  | 'DENSE_RETRY_EXHAUSTED'
  | 'DENSE_WORKER_SHUTTING_DOWN'
  | 'DENSE_UNCLASSIFIED_FAILURE';

export class DenseGenerationError extends Error {
  constructor(
    readonly code: DenseFailureCode,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
    readonly providerStatusClass?: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'DenseGenerationError';
  }
}

export interface SafeDenseFailure {
  readonly code: DenseFailureCode;
  readonly retryable: boolean;
  readonly category: 'retryable' | 'permanent';
  readonly retryAfterMs?: number;
  readonly providerStatusClass?: string;
}

export function classifyDenseFailure(value: unknown): SafeDenseFailure {
  if (value instanceof DenseGenerationError) {
    return {
      code: value.code,
      retryable: value.retryable,
      category: value.retryable ? 'retryable' : 'permanent',
      ...(value.retryAfterMs == null ? {} : { retryAfterMs: value.retryAfterMs }),
      ...(value.providerStatusClass == null ? {} : { providerStatusClass: value.providerStatusClass }),
    };
  }
  return { code: 'DENSE_UNCLASSIFIED_FAILURE', retryable: false, category: 'permanent' };
}
