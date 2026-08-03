import {
  CanonicalFilingDocument,
  FilingChunk,
} from '../../openDart/document/canonicalFilingContracts.js';

export interface VerifiedFilingMetadata {
  readonly corpCode: string;
  readonly symbol: string;
  readonly companyName?: string;
  readonly reportName?: string;
  readonly reportCode?: string;
  readonly filingDate?: string;
}

export interface PersistCanonicalFilingInput {
  readonly metadata: VerifiedFilingMetadata;
  readonly document: CanonicalFilingDocument;
  readonly chunks: readonly FilingChunk[];
}

export interface FilingPersistenceResult {
  readonly status: 'inserted' | 'already_present';
  readonly documentId: string;
  readonly canonicalFingerprint: string;
  readonly chunkFingerprint: string;
  readonly sectionCount: number;
  readonly blockCount: number;
  readonly chunkCount: number;
}

export interface FilingPersistenceSnapshot {
  readonly document: {
    readonly id: string;
    readonly provider: string;
    readonly receiptNumber: string;
    readonly corpCode: string;
    readonly symbol: string;
    readonly canonicalSchemaVersion: string;
    readonly parserVersion: string;
    readonly chunkSchemaVersion: string;
    readonly chunkerVersion: string;
    readonly canonicalFingerprint: string;
    readonly chunkFingerprint: string;
    readonly sectionCount: number;
    readonly blockCount: number;
    readonly chunkCount: number;
    readonly isRetrievalReady: boolean;
    readonly createdAt: Date;
  };
  readonly sections: readonly {
    readonly sectionId: string;
    readonly parentSectionId: string | null;
    readonly title: string | null;
    readonly depth: number;
    readonly ordinal: number;
    readonly path: readonly string[];
    readonly blockIds: readonly string[];
  }[];
  readonly blocks: readonly {
    readonly blockId: string;
    readonly sectionId: string | null;
    readonly blockType: string;
    readonly ordinal: number;
    readonly sourceText: string;
    readonly retrievalText: string;
    readonly contentHash: string;
    readonly locator: unknown;
    readonly tableData: unknown | null;
  }[];
  readonly chunks: readonly {
    readonly chunkId: string;
    readonly ordinal: number;
    readonly sectionId: string | null;
    readonly sourceBlockIds: readonly string[];
    readonly sourceText: string;
    readonly retrievalText: string;
    readonly contentHash: string;
    readonly locator: unknown;
  }[];
}
