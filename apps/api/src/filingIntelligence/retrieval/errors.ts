export type ActiveCompanyLexicalSearchErrorCode =
  | 'FILING_ACTIVE_LEXICAL_SEARCH_INVALID_INPUT'
  | 'FILING_ACTIVE_LEXICAL_SEARCH_SCOPE_INTEGRITY_FAILURE';

export class ActiveCompanyLexicalSearchError extends Error {
  constructor(
    readonly code: ActiveCompanyLexicalSearchErrorCode,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'ActiveCompanyLexicalSearchError';
  }
}
