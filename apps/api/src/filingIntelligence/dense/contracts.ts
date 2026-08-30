export type DenseGenerationStatus = 'building' | 'ready' | 'failed';

export interface DenseChunkInput {
  readonly chunkRowId: string;
  readonly chunkId: string;
  readonly ordinal: number;
  readonly contentHash: string;
  readonly retrievalText: string;
  readonly inputFingerprint: string;
}

export interface DenseVectorInput {
  readonly chunkRowId: string;
  readonly chunkId: string;
  readonly inputFingerprint: string;
  readonly vector: readonly number[];
}

export interface DenseGeneration {
  readonly generationId: string;
  readonly documentId: string;
  readonly denseProfileId: string;
  readonly status: DenseGenerationStatus;
  readonly expectedVectorCount: number;
  readonly persistedVectorCount: number;
  readonly inputManifestFingerprint: string;
  readonly generationFingerprint?: string;
}
