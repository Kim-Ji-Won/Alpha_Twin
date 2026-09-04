import { DenseFailureCode } from '../dense/embeddingProvider.js';

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

export type ActiveCompanyDenseSearchErrorCode =
  | 'FILING_ACTIVE_DENSE_SEARCH_INVALID_INPUT'
  | 'FILING_ACTIVE_DENSE_SEARCH_SCOPE_INTEGRITY_FAILURE'
  | 'FILING_DENSE_QUERY_EMBEDDING_FAILED';

export class ActiveCompanyDenseSearchError extends Error {
  constructor(
    readonly code: ActiveCompanyDenseSearchErrorCode,
    readonly retryable: boolean,
    readonly providerFailureCode?: DenseFailureCode,
  ) {
    super(code);
    this.name = 'ActiveCompanyDenseSearchError';
  }
}
