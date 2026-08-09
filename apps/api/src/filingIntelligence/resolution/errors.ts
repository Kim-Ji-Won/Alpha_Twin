export type FilingResolutionErrorCode =
  | 'FILING_RESOLUTION_INVALID_INPUT'
  | 'FILING_RESOLUTION_FAMILY_IDENTITY_MISMATCH'
  | 'FILING_RESOLUTION_GRAPH_INTEGRITY_FAILURE'
  | 'FILING_RESOLUTION_CONTROL_INVALID'
  | 'FILING_RESOLUTION_CONTROL_STALE'
  | 'FILING_RESOLUTION_CONTROL_REFERENCE_INVALID'
  | 'FILING_RESOLUTION_MANUAL_SELECTION_INVALID'
  | 'FILING_RESOLUTION_MANUAL_SELECTION_CROSS_FAMILY'
  | 'FILING_RESOLUTION_MANUAL_SELECTION_INELIGIBLE'
  | 'FILING_RESOLUTION_TRANSACTION_FAILED';

export class FilingResolutionError extends Error {
  constructor(
    readonly code: FilingResolutionErrorCode,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'FilingResolutionError';
  }
}
