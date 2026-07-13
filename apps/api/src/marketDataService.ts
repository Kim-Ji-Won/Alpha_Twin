import { CACHE_STALE_MAX_AGE_MS, CACHE_TTL_MS, MemoryCache } from './cache.js';
import { CandleRange, ResponseMetadata, StockCandlesDto, StockQuoteDto, StockSummaryDto } from './contracts.js';
import { MarketDataProvider } from './providers/marketDataProvider.js';

export class MarketDataService {
  constructor(
    private readonly provider: MarketDataProvider,
    private readonly fallbackProvider: MarketDataProvider,
    private readonly cache = new MemoryCache(),
    private readonly allowMockFallback = true,
  ) {}

  private get cachePolicy() {
    return this.provider.cachePolicy ?? {
      quoteTtlMs: CACHE_TTL_MS.quote,
      candlesTtlMs: CACHE_TTL_MS.candles,
      quoteStaleMaxAgeMs: CACHE_STALE_MAX_AGE_MS.quote,
      candlesStaleMaxAgeMs: CACHE_STALE_MAX_AGE_MS.candles,
    };
  }

  async getQuote(symbol: string): Promise<StockQuoteDto> {
    const key = `quote:${this.provider.id}:${symbol}`;
    const fresh = this.cache.getFresh<StockQuoteDto>(key);
    if (fresh) return fresh;
    const stale = this.cache.getStale<StockQuoteDto>(key, this.cachePolicy.quoteStaleMaxAgeMs);

    try {
      const quote = await this.provider.getQuote(symbol);
      this.cache.set(key, quote, this.cachePolicy.quoteTtlMs);
      return quote;
    } catch (error) {
      if (stale) return { ...stale, stale: true };
      if (this.allowMockFallback && this.provider.id !== this.fallbackProvider.id) {
        return this.fallbackProvider.getQuote(symbol);
      }
      throw error;
    }
  }

  async getCandles(symbol: string, range: CandleRange): Promise<StockCandlesDto> {
    const key = `candles:${this.provider.id}:${symbol}:${range}`;
    const fresh = this.cache.getFresh<StockCandlesDto>(key);
    if (fresh) return fresh;
    const stale = this.cache.getStale<StockCandlesDto>(key, this.cachePolicy.candlesStaleMaxAgeMs);

    try {
      const candles = await this.provider.getDailyCandles(symbol, range);
      const value = this.candlesResponse(candles, this.provider.id, this.provider.isFallback, false);
      this.cache.set(key, value, this.cachePolicy.candlesTtlMs);
      return value;
    } catch (error) {
      if (stale) return { ...stale, metadata: { ...stale.metadata, stale: true } };
      if (this.allowMockFallback && this.provider.id !== this.fallbackProvider.id) {
        const candles = await this.fallbackProvider.getDailyCandles(symbol, range);
        return this.candlesResponse(candles, this.fallbackProvider.id, true, false);
      }
      throw error;
    }
  }

  async getSummary(symbol: string, range: CandleRange): Promise<StockSummaryDto> {
    const [quote, candleResponse] = await Promise.all([
      this.getQuote(symbol),
      this.getCandles(symbol, range),
    ]);
    const sources = [...new Set([quote.source, candleResponse.metadata.source])];
    return {
      quote,
      candles: candleResponse.candles,
      metadata: {
        asOf: quote.asOf,
        source: sources.join(' + '),
        stale: quote.stale || candleResponse.metadata.stale,
        fallback: quote.fallback || candleResponse.metadata.fallback,
      },
    };
  }

  private candlesResponse(
    candles: StockCandlesDto['candles'],
    source: string,
    fallback: boolean,
    stale: boolean,
  ): StockCandlesDto {
    const lastDate = candles.at(-1)?.date;
    const metadata: ResponseMetadata = {
      asOf: lastDate ?? new Date().toISOString(),
      source,
      stale,
      fallback,
    };
    return { candles, metadata };
  }
}
