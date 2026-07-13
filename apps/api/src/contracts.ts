export type CandleRange = '1m' | '3m' | '6m' | '1y';

export interface StockQuoteDto {
  symbol: string;
  name: string;
  market: string;
  sector?: string;
  currency: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: number;
  tradingValue?: number;
  asOf: string;
  source: string;
  stale: boolean;
  fallback: boolean;
}

export interface StockCandleDto {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
}

export interface ResponseMetadata {
  asOf: string;
  source: string;
  stale: boolean;
  fallback: boolean;
}

export interface StockCandlesDto {
  candles: StockCandleDto[];
  metadata: ResponseMetadata;
}

export interface StockSummaryDto {
  quote: StockQuoteDto;
  candles: StockCandleDto[];
  metadata: ResponseMetadata;
}

export interface ApiErrorDto {
  error: {
    code: string;
    message: string;
  };
  metadata: ResponseMetadata;
}
