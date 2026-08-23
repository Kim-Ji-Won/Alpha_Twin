export type FilingRetrievalActivationErrorCode =
  | 'FILING_ACTIVATION_INVALID_INPUT'
  | 'FILING_ACTIVATION_FAMILY_NOT_FOUND'
  | 'FILING_ACTIVATION_STALE_RESOLUTION'
  | 'FILING_ACTIVATION_REPRESENTATION_AMBIGUOUS'
  | 'FILING_ACTIVATION_INTEGRITY_FAILURE'
  | 'FILING_ACTIVATION_TRANSACTION_FAILED';

export class FilingRetrievalActivationError extends Error {
  constructor(
    readonly code: FilingRetrievalActivationErrorCode,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'FilingRetrievalActivationError';
  }
}
