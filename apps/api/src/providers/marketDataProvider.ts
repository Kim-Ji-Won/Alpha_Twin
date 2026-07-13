import { CandleRange, StockCandleDto, StockQuoteDto } from '../contracts.js';

export interface MarketDataCachePolicy {
  quoteTtlMs: number;
  candlesTtlMs: number;
  quoteStaleMaxAgeMs: number;
  candlesStaleMaxAgeMs: number;
}

export interface MarketDataProvider {
  readonly id: string;
  readonly isFallback: boolean;
  readonly cachePolicy?: MarketDataCachePolicy;
  getQuote(symbol: string): Promise<StockQuoteDto>;
  getDailyCandles(symbol: string, range: CandleRange): Promise<StockCandleDto[]>;
}
