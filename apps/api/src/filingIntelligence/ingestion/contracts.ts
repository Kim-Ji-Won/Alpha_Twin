export const INGESTION_JOB_STATUSES = [
  'pending', 'leased', 'retryable_failed', 'succeeded',
  'permanent_failed', 'quarantined', 'cancelled',
] as const;
export type IngestionJobStatus = typeof INGESTION_JOB_STATUSES[number];

export const INGESTION_JOB_STAGES = [
  'queued', 'acquiring', 'parsing', 'chunking', 'persisting', 'completed', 'failed',
] as const;
export type IngestionJobStage = typeof INGESTION_JOB_STAGES[number];

export const INGESTION_ATTEMPT_STAGES = [
  'acquiring', 'parsing', 'chunking', 'persisting', 'completed', 'failed',
] as const;
export type IngestionAttemptStage = typeof INGESTION_ATTEMPT_STAGES[number];

export const INGESTION_ATTEMPT_OUTCOMES = [
  'running', 'succeeded', 'retryable_failed', 'permanent_failed',
  'quarantined', 'lease_expired', 'cancelled',
] as const;
export type IngestionAttemptOutcome = typeof INGESTION_ATTEMPT_OUTCOMES[number];

export interface VerifiedIngestionJobInput {
  readonly provider: 'opendart-fss';
  readonly receiptNumber: string;
  readonly corpCode: string;
  readonly symbol: string;
  readonly companyName?: string;
  readonly reportName?: string;
  readonly reportCode?: string;
  readonly filingDate?: string;
  readonly canonicalSchemaName: string;
  readonly canonicalSchemaVersion: string;
  readonly parserVersion: string;
  readonly chunkSchemaVersion: string;
  readonly chunkerVersion: string;
  readonly priority?: number;
  readonly maxAttempts?: number;
  readonly availableAt?: Date;
}

export type EnqueueResult = {
  readonly status: 'enqueued' | 'already_enqueued' | 'already_succeeded' | 'terminal_failure_exists';
  readonly jobId: string;
  readonly jobStatus: IngestionJobStatus;
};

export interface ClaimedIngestionJob {
  readonly id: string;
  readonly provider: 'opendart-fss';
  readonly receiptNumber: string;
  readonly corpCode: string;
  readonly symbol: string;
  readonly companyName?: string;
  readonly reportName?: string;
  readonly reportCode?: string;
  readonly filingDate?: string;
  readonly canonicalSchemaName: string;
  readonly canonicalSchemaVersion: string;
  readonly parserVersion: string;
  readonly chunkSchemaVersion: string;
  readonly chunkerVersion: string;
  readonly priority: number;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly workerId: string;
  readonly leaseToken: string;
  readonly leaseExpiresAt: Date;
}

export interface SafeIngestionFailure {
  readonly code: string;
  readonly category: 'retryable' | 'permanent' | 'quarantine';
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
}

export interface IngestionAttemptMetrics {
  readonly sourceEntryBytes?: number;
  readonly sectionCount?: number;
  readonly blockCount?: number;
  readonly chunkCount?: number;
  readonly acquisitionMs?: number;
  readonly parseMs?: number;
  readonly chunkMs?: number;
  readonly persistenceMs?: number;
  readonly totalMs?: number;
}

export type LeaseMutationResult = { readonly status: 'updated' } | { readonly status: 'lease_lost' };

export interface IngestionJobSnapshot {
  readonly id: string;
  readonly status: IngestionJobStatus;
  readonly stage: IngestionJobStage;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly availableAt: Date;
  readonly leaseToken?: string;
  readonly persistedDocumentId?: string;
  readonly lastErrorCode?: string;
}
