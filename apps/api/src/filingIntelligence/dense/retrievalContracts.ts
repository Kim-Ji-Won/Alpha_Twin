export const FILING_DENSE_RETRIEVAL_BOUNDS = Object.freeze({
  maximumDocumentScope: 20,
  defaultTopK: 8,
  maximumTopK: 20,
  cosineDistanceEpsilon: 1e-6,
});

export type DenseNotReadyReason =
  | 'generation_missing'
  | 'generation_building'
  | 'generation_failed';

export interface ResolveDenseReadinessInput {
  readonly corpCode: string;
  readonly symbol: string;
  readonly documentIds: readonly string[];
  readonly denseProfileId: string;
}

export interface DenseReadyGenerationReference {
  readonly documentId: string;
  readonly generationId: string;
  readonly generationFingerprint: string;
  readonly representationFingerprint: string;
  readonly inputManifestFingerprint: string;
  readonly expectedVectorCount: number;
}

interface DenseReadinessBase {
  readonly denseProfileId: string;
  readonly denseProfileFingerprint: string;
}

export type DenseReadinessResult =
  | DenseReadinessBase & {
    readonly status: 'ready';
    readonly generations: readonly DenseReadyGenerationReference[];
  }
  | DenseReadinessBase & {
    readonly status: 'not_ready';
    readonly generations: readonly [];
    readonly reasons: readonly [
      { readonly documentId: string; readonly reason: DenseNotReadyReason },
      ...{ readonly documentId: string; readonly reason: DenseNotReadyReason }[],
    ];
  };

export interface RetrieveDenseFilingChunksInput {
  readonly corpCode: string;
  readonly symbol: string;
  readonly denseProfileId: string;
  readonly denseProfileFingerprint: string;
  readonly generations: readonly DenseReadyGenerationReference[];
  readonly queryVector: readonly number[];
  readonly topK?: number;
}

export interface FilingDenseCandidate {
  readonly documentId: string;
  readonly chunkRowId: string;
  readonly chunkId: string;
  readonly generationId: string;
  readonly generationFingerprint: string;
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
  readonly denseProfileId: string;
  readonly denseRank: number;
  readonly denseSimilarity: number;
}
