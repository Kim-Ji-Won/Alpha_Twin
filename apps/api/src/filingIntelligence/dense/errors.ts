export type FilingDenseErrorCode =
  | 'FILING_DENSE_INVALID_INPUT' | 'FILING_DENSE_PROFILE_UNKNOWN'
  | 'FILING_DENSE_PROFILE_DRIFT' | 'FILING_DENSE_REPRESENTATION_INVALID'
  | 'FILING_DENSE_VECTOR_INVALID' | 'FILING_DENSE_VECTOR_CONFLICT'
  | 'FILING_DENSE_GENERATION_CONFLICT' | 'FILING_DENSE_GENERATION_INCOMPLETE'
  | 'FILING_DENSE_INTEGRITY_FAILURE' | 'FILING_DENSE_TRANSACTION_FAILED';

export class FilingDenseError extends Error {
  constructor(readonly code: FilingDenseErrorCode, readonly retryable: boolean, options?: ErrorOptions) {
    super(code, options); this.name = 'FilingDenseError';
  }
}
