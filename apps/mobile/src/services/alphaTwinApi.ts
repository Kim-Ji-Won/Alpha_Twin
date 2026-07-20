import { StockCandle } from '@/src/types';

interface StockQuoteDto {
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
  dataMode?: 'eod' | 'realtime' | 'mock';
  priceAdjustment?: 'raw' | 'adjusted' | 'unknown';
}

export interface StockSummaryDto {
  quote: StockQuoteDto;
  candles: StockCandle[];
  metadata: {
    asOf: string;
    source: string;
    stale: boolean;
    fallback: boolean;
    dataMode?: 'eod' | 'realtime' | 'mock';
    priceAdjustment?: 'raw' | 'adjusted' | 'unknown';
  };
}

const API_BASE_URL = process.env.EXPO_PUBLIC_ALPHA_TWIN_API_BASE_URL?.replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 4_500;

function assertSummary(value: unknown): asserts value is StockSummaryDto {
  if (!value || typeof value !== 'object') throw new Error('Invalid API response');
  const summary = value as Partial<StockSummaryDto>;
  if (!summary.quote || !Array.isArray(summary.candles) || !summary.metadata) {
    throw new Error('Invalid summary response');
  }
  const quote = summary.quote as Partial<StockQuoteDto>;
  if (
    typeof quote.symbol !== 'string' ||
    typeof quote.name !== 'string' ||
    typeof quote.price !== 'number' ||
    typeof quote.changePercent !== 'number' ||
    typeof quote.asOf !== 'string'
  ) {
    throw new Error('Invalid quote response');
  }
}

export const alphaTwinApi = {
  async getStockSummary(symbol: string): Promise<StockSummaryDto> {
    if (!API_BASE_URL) throw new Error('ALPHA TWIN API base URL is not configured');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/stocks/${encodeURIComponent(symbol)}/summary?range=1m`,
        { headers: { Accept: 'application/json' }, signal: controller.signal },
      );
      if (!response.ok) throw new Error(`ALPHA TWIN API request failed: ${response.status}`);
      const body: unknown = await response.json();
      assertSummary(body);
      return body;
    } finally {
      clearTimeout(timeout);
    }
  },
};
