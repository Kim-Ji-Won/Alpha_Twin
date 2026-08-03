import { createHash } from 'node:crypto';

import { FILING_LEXICAL_PROFILE } from './profile.js';

export interface WeightedLexemes {
  readonly chunkRowId: string;
  readonly chunkId: string;
  readonly chunkContentHash: string;
  readonly weightA: readonly string[];
  readonly weightB: readonly string[];
  readonly weightC: readonly string[];
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function lexicalContentHash(value: WeightedLexemes): string {
  return hash({
    profile: FILING_LEXICAL_PROFILE,
    chunkRowId: value.chunkRowId,
    chunkId: value.chunkId,
    chunkContentHash: value.chunkContentHash,
    weightA: value.weightA,
    weightB: value.weightB,
    weightC: value.weightC,
  });
}

export function lexicalGenerationFingerprint(
  values: readonly { readonly chunkId: string; readonly hash: string; readonly lexemeCount: number }[],
): string {
  return hash({ profile: FILING_LEXICAL_PROFILE, chunks: values });
}
