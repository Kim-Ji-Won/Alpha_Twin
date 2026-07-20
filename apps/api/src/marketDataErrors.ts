export type MarketDataErrorCode =
  | 'INVALID_SYMBOL'
  | 'SYMBOL_NOT_FOUND'
  | 'NOT_CONFIGURED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'UPSTREAM_REJECTED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'PAGINATION_LIMIT';

export class MarketDataError extends Error {
  constructor(readonly code: MarketDataErrorCode, message: string) {
    super(message);
    this.name = 'MarketDataError';
  }
}

export function isMarketDataError(error: unknown, code?: MarketDataErrorCode): error is MarketDataError {
  return error instanceof MarketDataError && (code == null || error.code === code);
}
