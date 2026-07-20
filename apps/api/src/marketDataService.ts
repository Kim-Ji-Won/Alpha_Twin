import { CACHE_STALE_MAX_AGE_MS, CACHE_TTL_MS, CacheStore, MemoryCache } from './cache.js';
import { CandleRange, ResponseMetadata, StockCandleDto, StockCandlesDto, StockQuoteDto, StockSummaryDto } from './contracts.js';
import { isMarketDataError, MarketDataError } from './marketDataErrors.js';
import { MarketDataObservability, SafeLogger } from './observability.js';
import { MarketDataProvider } from './providers/marketDataProvider.js';

export class MarketDataService {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly provider: MarketDataProvider,
    private readonly fallbackProvider: MarketDataProvider,
    private readonly cache: CacheStore = new MemoryCache(),
    private readonly allowMockFallback = true,
    private readonly observability = new MarketDataObservability(),
  ) {}

  private get cachePolicy() {
    return this.provider.cachePolicy ?? {
      quoteTtlMs: CACHE_TTL_MS.quote,
      candlesTtlMs: CACHE_TTL_MS.candles,
      quoteStaleMaxAgeMs: CACHE_STALE_MAX_AGE_MS.quote,
      candlesStaleMaxAgeMs: CACHE_STALE_MAX_AGE_MS.candles,
    };
  }

  get status() {
    return {
      provider: this.provider.id,
      dataMode: this.provider.dataMode ?? 'mock',
      cache: this.cache.kind,
      cacheEntries: this.cache.size,
      events: this.observability.snapshot(),
      lastEvent: this.observability.latest(),
    };
  }

  setLogger(logger: SafeLogger): void {
    this.observability.setLogger(logger);
  }

  async getQuote(symbol: string): Promise<StockQuoteDto> {
    const key = `market-data:${this.provider.id}:quote:${symbol}`;
    const entry = await this.cache.get<StockQuoteDto>(key);
    if (entry && this.cache.isFresh(entry)) {
      this.record('cache_fresh_hit', symbol);
      return entry.value;
    }
    return this.singleFlight(key, symbol, undefined, async () => {
      const current = await this.cache.get<StockQuoteDto>(key);
      if (current && this.cache.isFresh(current)) return current.value;
      try {
        const quote = await this.provider.getQuote(symbol);
        this.assertQuote(quote, symbol);
        await this.cache.set(
          key,
          quote,
          this.cachePolicy.quoteTtlMs,
          this.cachePolicy.quoteStaleMaxAgeMs,
        );
        return quote;
      } catch (error) {
        if (isMarketDataError(error, 'SYMBOL_NOT_FOUND')) {
          this.record('symbol_not_found', symbol, undefined, error.code);
          throw error;
        }
        const stale = await this.cache.get<StockQuoteDto>(key);
        if (stale) {
          this.record('cache_stale_hit', symbol);
          return { ...stale.value, stale: true };
        }
        return this.getFallbackQuote(symbol, error);
      }
    });
  }

  async getCandles(symbol: string, range: CandleRange): Promise<StockCandlesDto> {
    const key = `market-data:${this.provider.id}:candles:${symbol}:${range}`;
    const entry = await this.cache.get<StockCandlesDto>(key);
    if (entry && this.cache.isFresh(entry)) {
      this.record('cache_fresh_hit', symbol, range);
      return entry.value;
    }
    return this.singleFlight(key, symbol, range, async () => {
      const current = await this.cache.get<StockCandlesDto>(key);
      if (current && this.cache.isFresh(current)) return current.value;
      try {
        const candles = await this.provider.getDailyCandles(symbol, range);
        this.assertCandles(candles, symbol);
        const value = this.candlesResponse(candles, this.provider, false);
        await this.cache.set(
          key,
          value,
          this.cachePolicy.candlesTtlMs,
          this.cachePolicy.candlesStaleMaxAgeMs,
        );
        return value;
      } catch (error) {
        if (isMarketDataError(error, 'SYMBOL_NOT_FOUND')) {
          this.record('symbol_not_found', symbol, range, error.code);
          throw error;
        }
        const stale = await this.cache.get<StockCandlesDto>(key);
        if (stale) {
          this.record('cache_stale_hit', symbol, range);
          return { ...stale.value, metadata: { ...stale.value.metadata, stale: true } };
        }
        return this.getFallbackCandles(symbol, range, error);
      }
    });
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
        dataMode: quote.dataMode ?? candleResponse.metadata.dataMode,
        priceAdjustment: quote.priceAdjustment ?? candleResponse.metadata.priceAdjustment,
      },
    };
  }

  private async singleFlight<T>(
    key: string,
    symbol: string,
    range: CandleRange | undefined,
    load: () => Promise<T>,
  ): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) {
      this.record('inflight_dedup_hit', symbol, range);
      return existing;
    }
    const request = load().finally(() => {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    });
    this.inFlight.set(key, request);
    return request;
  }

  private async getFallbackQuote(symbol: string, originalError: unknown): Promise<StockQuoteDto> {
    if (!this.allowMockFallback || this.provider.id === this.fallbackProvider.id) throw originalError;
    try {
      const quote = await this.fallbackProvider.getQuote(symbol);
      this.record('mock_fallback', symbol);
      return quote;
    } catch {
      throw originalError;
    }
  }

  private async getFallbackCandles(
    symbol: string,
    range: CandleRange,
    originalError: unknown,
  ): Promise<StockCandlesDto> {
    if (!this.allowMockFallback || this.provider.id === this.fallbackProvider.id) throw originalError;
    try {
      const candles = await this.fallbackProvider.getDailyCandles(symbol, range);
      this.record('mock_fallback', symbol, range);
      return this.candlesResponse(candles, this.fallbackProvider, false);
    } catch {
      throw originalError;
    }
  }

  private candlesResponse(
    candles: StockCandlesDto['candles'],
    provider: MarketDataProvider,
    stale: boolean,
  ): StockCandlesDto {
    const lastDate = candles.at(-1)?.date;
    const metadata: ResponseMetadata = {
      asOf: lastDate ?? new Date().toISOString(),
      source: provider.id,
      stale,
      fallback: provider.isFallback,
      dataMode: provider.dataMode,
      priceAdjustment: provider.priceAdjustment,
    };
    return { candles, metadata };
  }

  private record(type: Parameters<MarketDataObservability['record']>[0]['type'], symbol: string, range?: string, category?: string): void {
    this.observability.record({ type, provider: this.provider.id, symbol, range, category });
  }

  private assertQuote(quote: StockQuoteDto, symbol: string): void {
    if (
      quote.symbol !== symbol
      || typeof quote.name !== 'string' || !quote.name.trim()
      || typeof quote.market !== 'string' || !quote.market.trim()
      || typeof quote.currency !== 'string' || !quote.currency.trim()
      || typeof quote.source !== 'string' || !quote.source.trim()
      || typeof quote.asOf !== 'string' || !quote.asOf.trim()
      || !Number.isFinite(quote.price)
      || !Number.isFinite(quote.change)
      || !Number.isFinite(quote.changePercent)
    ) {
      throw new MarketDataError('INVALID_RESPONSE', 'Market data provider returned an invalid quote');
    }
  }

  private assertCandles(candles: StockCandleDto[], symbol: string): void {
    const valid = candles.every(candle => (
      candle.symbol === symbol
      && typeof candle.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candle.date)
      && typeof candle.source === 'string' && candle.source.trim().length > 0
      && [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
      && candle.high >= Math.max(candle.open, candle.close, candle.low)
      && candle.low <= Math.min(candle.open, candle.close, candle.high)
      && candle.volume >= 0
    ));
    if (!valid) throw new MarketDataError('INVALID_RESPONSE', 'Market data provider returned invalid candles');
  }
}
