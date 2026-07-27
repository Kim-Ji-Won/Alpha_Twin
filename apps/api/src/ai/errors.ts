export type AiErrorCode =
  | 'INVALID_AI_REQUEST'
  | 'AI_NOT_CONFIGURED'
  | 'AI_CONTEXT_NOT_FOUND'
  | 'AI_CONTEXT_INCONSISTENT'
  | 'AI_CONTEXT_BUILD_FAILED'
  | 'AI_PROVIDER_RATE_LIMITED'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'AI_OUTPUT_INCOMPLETE'
  | 'AI_OUTPUT_SCHEMA_INVALID'
  | 'AI_EVIDENCE_INVALID';

const SAFE_MESSAGES: Record<AiErrorCode, string> = {
  INVALID_AI_REQUEST: 'AI analysis request is invalid',
  AI_NOT_CONFIGURED: 'AI analysis is not configured',
  AI_CONTEXT_NOT_FOUND: 'Company analysis context was not found',
  AI_CONTEXT_INCONSISTENT: 'Company analysis context is inconsistent',
  AI_CONTEXT_BUILD_FAILED: 'Company analysis context could not be built safely',
  AI_PROVIDER_RATE_LIMITED: 'AI analysis service is temporarily rate limited',
  AI_PROVIDER_UNAVAILABLE: 'AI analysis service is temporarily unavailable',
  AI_TIMEOUT: 'AI analysis timed out',
  AI_OUTPUT_INCOMPLETE: 'AI analysis response was incomplete',
  AI_OUTPUT_SCHEMA_INVALID: 'AI analysis response could not be validated safely',
  AI_EVIDENCE_INVALID: 'AI analysis evidence could not be validated safely',
};

const HTTP_STATUS: Record<AiErrorCode, number> = {
  INVALID_AI_REQUEST: 400,
  AI_NOT_CONFIGURED: 503,
  AI_CONTEXT_NOT_FOUND: 404,
  AI_CONTEXT_INCONSISTENT: 502,
  AI_CONTEXT_BUILD_FAILED: 502,
  AI_PROVIDER_RATE_LIMITED: 503,
  AI_PROVIDER_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
  AI_OUTPUT_INCOMPLETE: 502,
  AI_OUTPUT_SCHEMA_INVALID: 502,
  AI_EVIDENCE_INVALID: 502,
};

export class AiError extends Error {
  readonly safeMessage: string;
  readonly httpStatus: number;

  constructor(
    readonly code: AiErrorCode,
    readonly providerStatus?: number,
    readonly providerCode?: string,
    readonly providerRequestId?: string,
    options?: ErrorOptions,
  ) {
    super(SAFE_MESSAGES[code], options);
    this.name = 'AiError';
    this.safeMessage = SAFE_MESSAGES[code];
    this.httpStatus = HTTP_STATUS[code];
  }
}

export function isAiError(value: unknown): value is AiError {
  return value instanceof AiError;
}
