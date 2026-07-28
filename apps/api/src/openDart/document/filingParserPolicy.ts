export interface FilingParserPolicy {
  readonly maximumDepth: number;
  readonly maximumStructuralNodes: number;
  readonly maximumCanonicalBlocks: number;
  readonly maximumSections: number;
}

export interface FilingChunkPolicy {
  readonly maximumChars: number;
  readonly maximumChunks: number;
}

export const DEFAULT_FILING_PARSER_POLICY: FilingParserPolicy = Object.freeze({
  maximumDepth: 128,
  maximumStructuralNodes: 1_000_000,
  maximumCanonicalBlocks: 100_000,
  maximumSections: 10_000,
});

// Policy v1 is character-bounded until retrieval evaluation introduces a tokenizer.
export const DEFAULT_FILING_CHUNK_POLICY: FilingChunkPolicy = Object.freeze({
  maximumChars: 2_400,
  maximumChunks: 100_000,
});

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

export function validateFilingParserPolicy(policy: FilingParserPolicy): FilingParserPolicy {
  positiveInteger(policy.maximumDepth, 'maximumDepth');
  positiveInteger(policy.maximumStructuralNodes, 'maximumStructuralNodes');
  positiveInteger(policy.maximumCanonicalBlocks, 'maximumCanonicalBlocks');
  positiveInteger(policy.maximumSections, 'maximumSections');
  return policy;
}

export function validateFilingChunkPolicy(policy: FilingChunkPolicy): FilingChunkPolicy {
  positiveInteger(policy.maximumChars, 'maximumChars');
  positiveInteger(policy.maximumChunks, 'maximumChunks');
  if (policy.maximumChars < 128) {
    throw new Error('maximumChars must be at least 128');
  }
  return policy;
}
