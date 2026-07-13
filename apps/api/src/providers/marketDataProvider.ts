import { CandleRange, StockCandleDto, StockQuoteDto } from '../contracts.js';

export interface MarketDataProvider {
  readonly id: string;
  readonly isFallback: boolean;
  getQuote(symbol: string): Promise<StockQuoteDto>;
  getDailyCandles(symbol: string, range: CandleRange): Promise<StockCandleDto[]>;
}
