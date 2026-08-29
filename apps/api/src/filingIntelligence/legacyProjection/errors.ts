export type LegacyFilingProjectionErrorCode =
  | 'FILING_LEGACY_PROJECTION_INVALID_INPUT'
  | 'FILING_LEGACY_PROJECTION_FAMILY_NOT_FOUND'
  | 'FILING_LEGACY_PROJECTION_ACTIVATION_INTEGRITY_FAILURE'
  | 'FILING_LEGACY_PROJECTION_ELIGIBILITY_STALE'
  | 'FILING_LEGACY_PROJECTION_OWNERSHIP_FAILURE'
  | 'FILING_LEGACY_PROJECTION_TRANSACTION_FAILURE';

export class LegacyFilingProjectionError extends Error {
  constructor(
    readonly code: LegacyFilingProjectionErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'LegacyFilingProjectionError';
  }
}
