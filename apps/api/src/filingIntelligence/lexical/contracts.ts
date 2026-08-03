export interface LexicalField {
  readonly lexemes: readonly string[];
  readonly payload: string;
}

export interface FilingLexicalIndexResult {
  readonly status: 'indexed' | 'already_indexed';
  readonly generationId: string;
  readonly documentId: string;
  readonly profileId: string;
  readonly lexicalFingerprint: string;
  readonly chunkCount: number;
  readonly totalLexemeCount: number;
}

export interface RetrieveLexicalFilingChunksInput {
  readonly symbol: string;
  readonly corpCode: string;
  readonly documentIds: readonly string[];
  readonly query: string;
  readonly topK?: number;
}

export interface FilingLexicalCandidate {
  readonly documentId: string;
  readonly chunkRowId: string;
  readonly chunkId: string;
  readonly provider: string;
  readonly receiptNumber: string;
  readonly corpCode: string;
  readonly symbol: string;
  readonly reportName?: string;
  readonly filingDate?: string;
  readonly sectionId?: string;
  readonly sectionPath: readonly string[];
  readonly ordinal: number;
  readonly sourceText: string;
  readonly retrievalText: string;
  readonly locator: Readonly<Record<string, unknown>>;
  readonly contentHash: string;
  readonly parserVersion: string;
  readonly chunkerVersion: string;
  readonly lexicalProfileId: string;
  readonly lexicalRank: number;
}
