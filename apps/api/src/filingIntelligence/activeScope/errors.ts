export type ActiveFilingScopeErrorCode =
  | 'FILING_ACTIVE_SCOPE_INVALID_INPUT'
  | 'FILING_ACTIVE_SCOPE_POLICY_UNKNOWN'
  | 'FILING_ACTIVE_SCOPE_TOO_LARGE'
  | 'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE'
  | 'FILING_ACTIVE_SCOPE_ELIGIBILITY_STALE'
  | 'FILING_ACTIVE_SCOPE_REPRESENTATION_INTEGRITY_FAILURE'
  | 'FILING_ACTIVE_SCOPE_POLICY_DRIFT'
  | 'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE'
  | 'FILING_ACTIVE_SCOPE_TRANSACTION_FAILURE';

export class ActiveFilingScopeError extends Error {
  constructor(
    readonly code: ActiveFilingScopeErrorCode,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'ActiveFilingScopeError';
  }
}
