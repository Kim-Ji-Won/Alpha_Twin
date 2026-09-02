import OpenAI from 'openai';
import type { CreateEmbeddingResponse, EmbeddingCreateParams } from 'openai/resources/embeddings';

import { canonicalizeDenseVector } from './fingerprints.js';
import {
  DenseGenerationError,
  EmbeddingBatchResult,
  EmbeddingInput,
  EmbeddingProvider,
  isCompatibleEmbeddingResponseModel,
} from './embeddingProvider.js';
import { FilingDenseProfile } from './profile.js';

interface EmbeddingsClient {
  create(body: EmbeddingCreateParams, options?: { signal?: AbortSignal }): Promise<CreateEmbeddingResponse>;
}

const MAX_RETRY_AFTER_MS = 15 * 60_000;

export function parseRetryAfterMs(headers: Headers | undefined, nowMs = Date.now()): number | undefined {
  const retryAfter = headers?.get('retry-after')?.trim();
  if (retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)) {
    const seconds = Number(retryAfter);
    return Number.isFinite(seconds) ? Math.min(MAX_RETRY_AFTER_MS, seconds * 1_000) : MAX_RETRY_AFTER_MS;
  }
  if (retryAfter && /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(retryAfter)) {
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, timestamp - nowMs));
  }
  const reset = headers?.get('x-ratelimit-reset-tokens') ?? headers?.get('x-ratelimit-reset-requests');
  const match = reset?.match(/^(\d+(?:\.\d+)?)(ms|s)$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return MAX_RETRY_AFTER_MS;
  return Math.min(MAX_RETRY_AFTER_MS, value * (match[2] === 's' ? 1_000 : 1));
}

function providerError(value: unknown): DenseGenerationError {
  if (value instanceof OpenAI.APIConnectionTimeoutError) {
    return new DenseGenerationError('DENSE_PROVIDER_TIMEOUT', true, undefined, undefined, { cause: value });
  }
  if (value instanceof OpenAI.APIConnectionError) {
    return new DenseGenerationError('DENSE_PROVIDER_UNAVAILABLE', true, undefined, undefined, { cause: value });
  }
  if (value instanceof OpenAI.APIUserAbortError) {
    return new DenseGenerationError('DENSE_WORKER_SHUTTING_DOWN', false, undefined, undefined, { cause: value });
  }
  if (value instanceof OpenAI.APIError) {
    const status = value.status;
    const statusClass = typeof status === 'number' ? `${Math.floor(status / 100)}xx` : undefined;
    if (status === 429) {
      return new DenseGenerationError('DENSE_PROVIDER_RATE_LIMITED', true,
        parseRetryAfterMs(value.headers), statusClass, { cause: value });
    }
    if (typeof status === 'number' && status >= 500) {
      return new DenseGenerationError('DENSE_PROVIDER_UNAVAILABLE', true,
        parseRetryAfterMs(value.headers), statusClass, { cause: value });
    }
    return new DenseGenerationError('DENSE_PROVIDER_INVALID_REQUEST', false,
      undefined, statusClass, { cause: value });
  }
  return new DenseGenerationError('DENSE_PROVIDER_UNAVAILABLE', true, undefined, undefined, { cause: value });
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  private readonly embeddings: EmbeddingsClient;

  constructor(apiKey: string, timeoutMs: number, embeddings?: EmbeddingsClient) {
    if (!apiKey.trim()) throw new DenseGenerationError('DENSE_PROVIDER_NOT_CONFIGURED', false);
    this.embeddings = embeddings ?? new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 0, logLevel: 'off' }).embeddings;
  }

  async embedBatch(
    profile: FilingDenseProfile,
    inputs: readonly EmbeddingInput[],
    signal?: AbortSignal,
  ): Promise<EmbeddingBatchResult> {
    if (inputs.length === 0 || inputs.some(input => !input.inputId || !input.text)) {
      throw new DenseGenerationError('DENSE_PROVIDER_INVALID_REQUEST', false);
    }
    let response: CreateEmbeddingResponse;
    try {
      response = await this.embeddings.create({
        model: profile.modelId,
        dimensions: profile.dimensions,
        encoding_format: 'float',
        input: inputs.map(input => input.text),
      }, { signal });
    } catch (value) {
      throw providerError(value);
    }
    if (!isCompatibleEmbeddingResponseModel(profile.modelId, response.model) || response.data.length !== inputs.length
      || !Number.isInteger(response.usage.prompt_tokens) || response.usage.prompt_tokens < 0) {
      throw new DenseGenerationError('DENSE_PROVIDER_RESPONSE_INVALID', false);
    }
    const vectors = new Array<{ inputId: string; vector: readonly number[] }>(inputs.length);
    const seen = new Set<number>();
    for (const item of response.data) {
      if (!Number.isInteger(item.index) || item.index < 0 || item.index >= inputs.length || seen.has(item.index)) {
        throw new DenseGenerationError('DENSE_PROVIDER_RESPONSE_INVALID', false);
      }
      let vector: readonly number[];
      try {
        vector = canonicalizeDenseVector(item.embedding);
      } catch {
        throw new DenseGenerationError('DENSE_PROVIDER_RESPONSE_INVALID', false);
      }
      if (vector.length !== profile.dimensions || !vector.some(value => value !== 0)) {
        throw new DenseGenerationError('DENSE_PROVIDER_RESPONSE_INVALID', false);
      }
      seen.add(item.index);
      vectors[item.index] = { inputId: inputs[item.index]!.inputId, vector };
    }
    if (vectors.some(value => value == null)) {
      throw new DenseGenerationError('DENSE_PROVIDER_RESPONSE_INVALID', false);
    }
    return { provider: 'openai', model: response.model, vectors, tokenCount: response.usage.prompt_tokens };
  }
}
