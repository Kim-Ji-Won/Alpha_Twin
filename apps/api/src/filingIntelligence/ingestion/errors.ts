export type IngestionErrorCode =
  | 'INGESTION_JOB_INVALID_INPUT'
  | 'INGESTION_JOB_CONFLICT'
  | 'INGESTION_LEASE_LOST'
  | 'INGESTION_INVALID_TRANSITION'
  | 'INGESTION_RETRY_EXHAUSTED'
  | 'INGESTION_WORKER_NOT_CONFIGURED'
  | 'INGESTION_WORKER_SHUTTING_DOWN'
  | 'INGESTION_SOURCE_IDENTITY_MISMATCH'
  | 'INGESTION_UNCLASSIFIED_FAILURE';

export class IngestionError extends Error {
  constructor(
    readonly code: IngestionErrorCode,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'IngestionError';
  }
}
