export type OpenDartOperation =
  | 'corp-code'
  | 'company-profile'
  | 'disclosures'
  | 'financial-statements'
  | 'latest-financial-report'
  | 'filing-document';

export type OpenDartErrorCode =
  | 'INVALID_SYMBOL'
  | 'INVALID_DISCLOSURE_QUERY'
  | 'INVALID_FINANCIAL_QUERY'
  | 'INVALID_LATEST_FINANCIAL_QUERY'
  | 'INVALID_RECEIPT'
  | 'CORP_CODE_NOT_FOUND'
  | 'CORP_CODE_CONFLICT'
  | 'CORP_CODE_INDEX_UNAVAILABLE'
  | 'CORP_CODE_ARCHIVE_INVALID'
  | 'OPENDART_NOT_CONFIGURED'
  | 'COMPANY_PROFILE_NOT_FOUND'
  | 'OPENDART_AUTH_ERROR'
  | 'OPENDART_RATE_LIMITED'
  | 'OPENDART_UNAVAILABLE'
  | 'OPENDART_BAD_REQUEST_MAPPING'
  | 'OPENDART_BAD_RESPONSE'
  | 'OPENDART_TIMEOUT'
  | 'FINANCIAL_REPORT_NOT_FOUND'
  | 'FINANCIAL_RESPONSE_INCONSISTENT'
  | 'FINANCIAL_ACCOUNT_VALUE_INVALID'
  | 'LATEST_FINANCIAL_REPORT_NOT_FOUND'
  | 'LATEST_FINANCIAL_REPORT_UNRESOLVED'
  | 'LATEST_FINANCIAL_REPORT_RESPONSE_INCONSISTENT'
  | 'LATEST_FINANCIAL_REPORT_RECEIPT_MISMATCH'
  | 'OPENDART_DOCUMENT_NOT_FOUND'
  | 'OPENDART_DOCUMENT_TOO_LARGE'
  | 'OPENDART_DOCUMENT_INVALID_ARCHIVE'
  | 'OPENDART_DOCUMENT_UNSAFE_ARCHIVE'
  | 'OPENDART_DOCUMENT_NO_ELIGIBLE_ENTRY';

const SAFE_MESSAGES: Record<OpenDartErrorCode, string> = {
  INVALID_SYMBOL: 'symbol must contain exactly six digits',
  INVALID_DISCLOSURE_QUERY: 'Disclosure query is invalid',
  INVALID_FINANCIAL_QUERY: 'Financial statement query is invalid',
  INVALID_LATEST_FINANCIAL_QUERY: 'Latest financial statement query is invalid',
  INVALID_RECEIPT: 'Receipt number must contain exactly fourteen digits',
  CORP_CODE_NOT_FOUND: 'Company identifier was not found',
  CORP_CODE_CONFLICT: 'Company identifier index is inconsistent',
  CORP_CODE_INDEX_UNAVAILABLE: 'Company identifier index is temporarily unavailable',
  CORP_CODE_ARCHIVE_INVALID: 'Company identifier archive is invalid',
  OPENDART_NOT_CONFIGURED: 'Company disclosure data is not configured',
  COMPANY_PROFILE_NOT_FOUND: 'Company profile was not found',
  OPENDART_AUTH_ERROR: 'Company disclosure provider authentication failed',
  OPENDART_RATE_LIMITED: 'Company disclosure provider limit was reached',
  OPENDART_UNAVAILABLE: 'Company disclosure provider is temporarily unavailable',
  OPENDART_BAD_REQUEST_MAPPING: 'Company disclosure request could not be processed',
  OPENDART_BAD_RESPONSE: 'Company disclosure provider returned an invalid response',
  OPENDART_TIMEOUT: 'Company disclosure provider timed out',
  FINANCIAL_REPORT_NOT_FOUND: 'Financial statement report was not found',
  FINANCIAL_RESPONSE_INCONSISTENT: 'Financial statement response is inconsistent',
  FINANCIAL_ACCOUNT_VALUE_INVALID: 'Financial statement amount is invalid',
  LATEST_FINANCIAL_REPORT_NOT_FOUND: 'Latest financial report was not found',
  LATEST_FINANCIAL_REPORT_UNRESOLVED: 'Latest financial report could not be resolved',
  LATEST_FINANCIAL_REPORT_RESPONSE_INCONSISTENT:
    'Latest financial report response is inconsistent',
  LATEST_FINANCIAL_REPORT_RECEIPT_MISMATCH:
    'Latest filing and financial statement receipts do not match',
  OPENDART_DOCUMENT_NOT_FOUND: 'Filing document was not found',
  OPENDART_DOCUMENT_TOO_LARGE: 'Filing document exceeded its size limit',
  OPENDART_DOCUMENT_INVALID_ARCHIVE: 'Filing document archive is invalid',
  OPENDART_DOCUMENT_UNSAFE_ARCHIVE: 'Filing document archive is unsafe',
  OPENDART_DOCUMENT_NO_ELIGIBLE_ENTRY: 'Filing document archive has no eligible document entry',
};

const HTTP_STATUS: Record<OpenDartErrorCode, number> = {
  INVALID_SYMBOL: 400,
  INVALID_DISCLOSURE_QUERY: 400,
  INVALID_FINANCIAL_QUERY: 400,
  INVALID_LATEST_FINANCIAL_QUERY: 400,
  INVALID_RECEIPT: 400,
  CORP_CODE_NOT_FOUND: 404,
  COMPANY_PROFILE_NOT_FOUND: 404,
  CORP_CODE_CONFLICT: 502,
  OPENDART_BAD_REQUEST_MAPPING: 502,
  OPENDART_BAD_RESPONSE: 502,
  FINANCIAL_RESPONSE_INCONSISTENT: 502,
  FINANCIAL_ACCOUNT_VALUE_INVALID: 502,
  FINANCIAL_REPORT_NOT_FOUND: 404,
  LATEST_FINANCIAL_REPORT_NOT_FOUND: 404,
  LATEST_FINANCIAL_REPORT_UNRESOLVED: 502,
  LATEST_FINANCIAL_REPORT_RESPONSE_INCONSISTENT: 502,
  LATEST_FINANCIAL_REPORT_RECEIPT_MISMATCH: 502,
  OPENDART_DOCUMENT_NOT_FOUND: 404,
  OPENDART_DOCUMENT_TOO_LARGE: 502,
  OPENDART_DOCUMENT_INVALID_ARCHIVE: 502,
  OPENDART_DOCUMENT_UNSAFE_ARCHIVE: 502,
  OPENDART_DOCUMENT_NO_ELIGIBLE_ENTRY: 502,
  CORP_CODE_INDEX_UNAVAILABLE: 503,
  CORP_CODE_ARCHIVE_INVALID: 503,
  OPENDART_NOT_CONFIGURED: 503,
  OPENDART_AUTH_ERROR: 503,
  OPENDART_RATE_LIMITED: 503,
  OPENDART_UNAVAILABLE: 503,
  OPENDART_TIMEOUT: 503,
};

export class OpenDartError extends Error {
  readonly safeMessage: string;
  readonly httpStatus: number;

  constructor(
    readonly code: OpenDartErrorCode,
    readonly operation: OpenDartOperation,
    readonly retryable: boolean,
    readonly providerStatus?: string,
    options?: ErrorOptions,
  ) {
    super(SAFE_MESSAGES[code], options);
    this.name = 'OpenDartError';
    this.safeMessage = SAFE_MESSAGES[code];
    this.httpStatus = HTTP_STATUS[code];
  }
}

export function isOpenDartError(value: unknown): value is OpenDartError {
  return value instanceof OpenDartError;
}

export function openDartErrorFromStatus(status: string, operation: OpenDartOperation): OpenDartError {
  if (['010', '011', '012', '901'].includes(status)) {
    return new OpenDartError('OPENDART_AUTH_ERROR', operation, false, status);
  }
  if (status === '020') return new OpenDartError('OPENDART_RATE_LIMITED', operation, true, status);
  if (['014', '800', '900'].includes(status)) {
    return new OpenDartError('OPENDART_UNAVAILABLE', operation, true, status);
  }
  if (['100', '101', '021'].includes(status)) {
    return new OpenDartError('OPENDART_BAD_REQUEST_MAPPING', operation, false, status);
  }
  return new OpenDartError('OPENDART_BAD_RESPONSE', operation, false, status);
}

export function openDartDocumentErrorFromStatus(status: string): OpenDartError {
  if (status === '013' || status === '014') {
    return new OpenDartError('OPENDART_DOCUMENT_NOT_FOUND', 'filing-document', false, status);
  }
  return openDartErrorFromStatus(status, 'filing-document');
}
