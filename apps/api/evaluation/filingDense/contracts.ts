export const DENSE_EVAL_DATASET_ID = 'dense-eval-v1' as const;
export const DENSE_EVAL_DATASET_SCHEMA = 'dense-eval-dataset@1' as const;
export const DENSE_EVAL_RESULT_SCHEMA = 'dense-eval-result@1' as const;
export const DENSE_EVAL_SMALL_PROFILE_ID = 'ko-financial-dense-openai-te3-small-1536-v1' as const;
export const DENSE_EVAL_LARGE_PROFILE_ID = 'ko-financial-dense-openai-te3-large-1536-v1' as const;

export const DENSE_EVAL_CATEGORIES = [
  'causal', 'segment', 'profit', 'capex', 'cash_flow', 'debt_liquidity',
  'dividend', 'risk', 'regulation_litigation', 'contract_customer', 'numeric',
  'period', 'paraphrase', 'synonym', 'lexical_sparse', 'table_targeted',
] as const;

export type DenseEvalCategory = typeof DENSE_EVAL_CATEGORIES[number];

export const DENSE_EVAL_CRITICAL_CATEGORIES = [
  'numeric', 'period', 'table_targeted', 'causal', 'risk',
] as const satisfies readonly DenseEvalCategory[];

export type DenseEvalSplit = 'dev' | 'holdout';
export type DenseEvalReviewStatus = 'pending' | 'reviewed' | 'sealed';
export type DenseEvalReportFamily = 'annual' | 'half_year' | 'quarterly';
export type DenseEvalEvidenceModality = 'narrative' | 'table';

export interface DenseEvalCompany {
  readonly corpCode: string;
  readonly symbol: string;
}

export interface DenseEvalChunkPin {
  readonly provider: 'opendart-fss';
  readonly corpCode: string;
  readonly symbol: string;
  readonly receiptNumber: string;
  readonly documentId: string;
  readonly chunkId: string;
  readonly contentHash: string;
  readonly representationFingerprint: string;
  readonly parserVersion: string;
  readonly chunkerVersion: string;
  readonly schemaVersion: string;
  readonly sectionPath: readonly string[];
  readonly locator: Readonly<Record<string, string | number | boolean>>;
}

export interface DenseEvalEvidenceGroup {
  readonly evidenceGroupId: string;
  // 2: direct core evidence; 1: relevant supporting/partial evidence. See goldenAuthoring.md.
  readonly grade: 1 | 2;
  readonly acceptableChunks: readonly DenseEvalChunkPin[];
}

export interface DenseEvalReviewEvidence {
  readonly status: DenseEvalReviewStatus;
  readonly reviewRoundCount: number;
  // Runtime validation requires both metadata fields for reviewed/sealed, neither for pending.
  readonly reviewedAt?: string;
  readonly reviewerRoleId?: string;
}

export interface DenseEvalEntry {
  readonly queryId: string;
  readonly split: DenseEvalSplit;
  readonly queryText: string;
  readonly categories: readonly DenseEvalCategory[];
  readonly company: DenseEvalCompany;
  readonly reportFamily: DenseEvalReportFamily;
  readonly evidenceModality: DenseEvalEvidenceModality;
  readonly currentEffectiveCorrection: boolean;
  readonly evidenceGroups: readonly DenseEvalEvidenceGroup[];
  readonly review: DenseEvalReviewEvidence;
  readonly notes?: string;
}

export interface DenseEvalDatasetPayload {
  readonly datasetId: typeof DENSE_EVAL_DATASET_ID;
  readonly schemaVersion: typeof DENSE_EVAL_DATASET_SCHEMA;
  readonly split: DenseEvalSplit;
  readonly targetCount: number;
  readonly entries: readonly DenseEvalEntry[];
}

export interface DenseEvalDatasetEnvelope {
  readonly payload: DenseEvalDatasetPayload;
  readonly canonicalHash: string;
}

export interface RankedEvidenceCandidate {
  readonly rank: number;
  readonly chunk: DenseEvalChunkPin;
  readonly modality?: 'dense' | 'lexical' | 'hybrid';
}

export interface DenseEvalMetrics {
  readonly hitAt5: 0 | 1;
  readonly hitAt10: 0 | 1;
  readonly recallAt5: number;
  readonly recallAt10: number;
  readonly reciprocalRankAt10: number;
  readonly ndcgAt10: number;
  readonly chunkRecallAt5: number;
  readonly chunkRecallAt10: number;
  readonly firstRelevantRank: number | null;
  readonly hitEvidenceGroupIds: readonly string[];
  readonly missingEvidenceGroupIds: readonly string[];
}

export type DenseEvalRunStatus =
  | 'valid'
  | 'invalid_scope_mismatch'
  | 'scope_empty'
  | 'dense_not_ready'
  | 'provider_failure'
  | 'integrity_failure'
  | 'timeout'
  | 'dataset_invalid';

export interface DenseEvalRunRecord {
  readonly queryId: string;
  readonly split: DenseEvalSplit;
  readonly categories: readonly DenseEvalCategory[];
  readonly company: DenseEvalCompany;
  readonly profileId: string;
  readonly profileFingerprint: string;
  readonly topK: number;
  readonly scopeFingerprint: string;
  readonly documents: readonly {
    readonly documentId: string;
    readonly representationFingerprint: string;
  }[];
  readonly status: DenseEvalRunStatus;
  readonly metrics?: DenseEvalMetrics;
  readonly failureCode?: string;
}

export class DenseEvaluationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DenseEvaluationError';
  }
}
