export type FilingLexicalErrorCode =
  | 'FILING_LEXICAL_INVALID_INPUT'
  | 'FILING_LEXICAL_PROFILE_UNSUPPORTED'
  | 'FILING_LEXICAL_INDEX_CONFLICT'
  | 'FILING_LEXICAL_INDEX_INTEGRITY_FAILURE'
  | 'FILING_LEXICAL_QUERY_INVALID'
  | 'FILING_LEXICAL_SCOPE_INVALID'
  | 'FILING_LEXICAL_RETRIEVAL_INTEGRITY_FAILURE'
  | 'FILING_LEXICAL_TRANSACTION_FAILED';

export class FilingLexicalError extends Error {
  constructor(
    readonly code: FilingLexicalErrorCode,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'FilingLexicalError';
  }
}
