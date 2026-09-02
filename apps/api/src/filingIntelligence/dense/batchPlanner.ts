import { getEncoding, getEncodingNameForModel, TiktokenModel } from 'js-tiktoken';

import { DenseGenerationError } from './embeddingProvider.js';
import { DenseChunkInput } from './contracts.js';
import { FilingDenseProfile, FILING_DENSE_PROFILES } from './profile.js';

export const DENSE_COST_LIMITS = Object.freeze({
  maximumChunksPerDocument: 2_000,
  maximumTokensPerInput: 8_192,
  maximumTokensPerDocument: 250_000,
  maximumTokensPerRequest: 100_000,
  maximumUtf8BytesPerRequest: 1_000_000,
  maximumProviderRequestsPerJob: 100,
});

export interface PlannedDenseInput extends DenseChunkInput {
  readonly tokenCount: number;
  readonly utf8Bytes: number;
}

export interface DenseBatchPlan {
  readonly batches: readonly (readonly PlannedDenseInput[])[];
  readonly totalTokens: number;
  readonly totalUtf8Bytes: number;
}

export interface DenseTokenizer {
  count(text: string): number;
}

export function createOpenAiEmbeddingTokenizer(): DenseTokenizer {
  const encodingNames = new Set(Object.values(FILING_DENSE_PROFILES)
    .map(profile => getEncodingNameForModel(profile.modelId as TiktokenModel)));
  if (encodingNames.size !== 1) throw new DenseGenerationError('DENSE_PROFILE_DRIFT', false);
  const encoding = getEncoding([...encodingNames][0]!);
  return { count(text) { return encoding.encode(text).length; } };
}

export function planDenseBatches(
  profile: FilingDenseProfile,
  chunks: readonly DenseChunkInput[],
  tokenizer: DenseTokenizer,
): DenseBatchPlan {
  if (chunks.length > DENSE_COST_LIMITS.maximumChunksPerDocument) {
    throw new DenseGenerationError('DENSE_COST_LIMIT_EXCEEDED', false);
  }
  const inputs = chunks.map(chunk => {
    const tokenCount = tokenizer.count(chunk.retrievalText);
    const utf8Bytes = Buffer.byteLength(chunk.retrievalText, 'utf8');
    if (!chunk.retrievalText || chunk.retrievalText.length > profile.maximumInputCharacters
      || tokenCount < 1 || tokenCount > DENSE_COST_LIMITS.maximumTokensPerInput) {
      throw new DenseGenerationError('DENSE_INPUT_LIMIT_EXCEEDED', false);
    }
    return { ...chunk, tokenCount, utf8Bytes };
  });
  const totalTokens = inputs.reduce((sum, input) => sum + input.tokenCount, 0);
  const totalUtf8Bytes = inputs.reduce((sum, input) => sum + input.utf8Bytes, 0);
  if (totalTokens > DENSE_COST_LIMITS.maximumTokensPerDocument) {
    throw new DenseGenerationError('DENSE_COST_LIMIT_EXCEEDED', false);
  }
  const batches: PlannedDenseInput[][] = [];
  let current: PlannedDenseInput[] = [];
  let tokens = 0;
  let bytes = 0;
  for (const input of inputs) {
    if (current.length > 0 && (current.length >= profile.maximumInputsPerBatch
      || tokens + input.tokenCount > DENSE_COST_LIMITS.maximumTokensPerRequest
      || bytes + input.utf8Bytes > DENSE_COST_LIMITS.maximumUtf8BytesPerRequest)) {
      batches.push(current); current = []; tokens = 0; bytes = 0;
    }
    current.push(input); tokens += input.tokenCount; bytes += input.utf8Bytes;
  }
  if (current.length > 0) batches.push(current);
  if (batches.length > DENSE_COST_LIMITS.maximumProviderRequestsPerJob) {
    throw new DenseGenerationError('DENSE_COST_LIMIT_EXCEEDED', false);
  }
  return { batches, totalTokens, totalUtf8Bytes };
}
