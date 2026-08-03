export const FILING_LEXICAL_PROFILE = {
  profileId: 'ko-financial-ngrams-v1',
  schemaVersion: 'filing-lexical-index@1',
  normalizerVersion: '1.0.0',
  textSearchConfig: 'simple',
  ngramSizes: [2, 3] as const,
  rankFunction: 'ts_rank_cd',
} as const;

export const FILING_LEXICAL_BOUNDS = {
  maximumSourceFieldCharacters: 12_000,
  maximumTokenLength: 128,
  maximumKoreanRunLength: 512,
  maximumLexemesPerField: 8_000,
  maximumLexemesPerChunk: 12_000,
  maximumQueryCharacters: 2_000,
  maximumQueryLexemes: 512,
  maximumDocumentScope: 20,
  defaultTopK: 8,
  maximumTopK: 20,
  insertionBatchSize: 100,
} as const;
