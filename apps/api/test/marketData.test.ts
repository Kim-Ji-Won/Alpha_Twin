import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import { MemoryCache, MemoryCacheStore } from '../src/cache.js';
import { loadConfig } from '../src/config.js';
import { CandleRange, StockCandleDto, StockQuoteDto } from '../src/contracts.js';
import { MarketDataService } from '../src/marketDataService.js';
import { MarketDataError } from '../src/marketDataErrors.js';
import { normalizeCandle, normalizeQuote } from '../src/normalizers.js';
import { MarketDataProvider } from '../src/providers/marketDataProvider.js';
import { MockMarketDataProvider } from '../src/providers/mockMarketDataProvider.js';

test('normalizes numeric strings for quote and candle DTOs', () => {
  const quote = normalizeQuote({
    symbol: '000660', name: 'SK하이닉스', market: 'KOSPI', currency: 'KRW',
    price: '178,400', change: '4,079', changePercent: '2.34', volume: '3,812,450',
    asOf: '2026-07-13T09:00:00+09:00',
  }, 'test');
  const candle = normalizeCandle({
    symbol: '000660', date: '2026-07-13', open: '175,000', high: '180,000',
    low: '174,000', close: '178,400', volume: '3,812,450',
  }, 'test');
  assert.equal(quote.price, 178400);
  assert.equal(quote.volume, 3812450);
  assert.equal(candle.close, 178400);
});

test('rejects missing required fields', () => {
  assert.throws(() => normalizeQuote({ symbol: '000660' }, 'test'), /Missing required field/);
});

test('cache returns a hit before provider is called again', async () => {
  const mock = new MockMarketDataProvider();
  let calls = 0;
  const provider: MarketDataProvider = {
    ...mock,
    id: 'counting',
    isFallback: false,
    async getQuote(symbol) { calls += 1; return mock.getQuote(symbol); },
    async getDailyCandles(symbol, range) { return mock.getDailyCandles(symbol, range); },
  };
  const service = new MarketDataService(provider, mock, new MemoryCache(), false);
  await service.getQuote('000660');
  await service.getQuote('000660');
  assert.equal(calls, 1);
});

test('returns stale cache when provider fails after expiry', async () => {
  const mock = new MockMarketDataProvider();
  let now = 0;
  let fail = false;
  const provider: MarketDataProvider = {
    id: 'flaky', isFallback: false,
    async getQuote(symbol): Promise<StockQuoteDto> {
      if (fail) throw new Error('provider failed');
      return mock.getQuote(symbol);
    },
    async getDailyCandles(symbol, range): Promise<StockCandleDto[]> {
      if (fail) throw new Error('provider failed');
      return mock.getDailyCandles(symbol, range);
    },
  };
  const service = new MarketDataService(provider, mock, new MemoryCache(() => now), false);
  await service.getQuote('000660');
  now = 60_000;
  fail = true;
  const stale = await service.getQuote('000660');
  assert.equal(stale.stale, true);
});

test('ignores stale cache beyond the provider max age and uses Mock fallback', async () => {
  const mock = new MockMarketDataProvider();
  let now = 0;
  let fail = false;
  const provider: MarketDataProvider = {
    id: 'short-stale',
    isFallback: false,
    cachePolicy: {
      quoteTtlMs: 1,
      candlesTtlMs: 1,
      quoteStaleMaxAgeMs: 5,
      candlesStaleMaxAgeMs: 5,
    },
    async getQuote(symbol) {
      if (fail) throw new Error('provider failed');
      return mock.getQuote(symbol).then(quote => ({ ...quote, source: 'short-stale', fallback: false }));
    },
    async getDailyCandles(symbol, range) { return mock.getDailyCandles(symbol, range); },
  };
  const service = new MarketDataService(provider, mock, new MemoryCache(() => now), true);
  await service.getQuote('000660');
  now = 10;
  fail = true;
  const fallback = await service.getQuote('000660');
  assert.equal(fallback.source, mock.id);
  assert.equal(fallback.fallback, true);
});

test('API validates symbols and returns all market endpoints', async t => {
  const config = loadConfig({ LOG_LEVEL: 'silent' });
  const mock = new MockMarketDataProvider();
  const service = new MarketDataService(mock, mock);
  const app = await buildApp(config, service);
  t.after(() => app.close());

  const bad = await app.inject({ method: 'GET', url: '/api/v1/stocks/SK/quote' });
  assert.equal(bad.statusCode, 400);
  const validButUnavailable = await app.inject({ method: 'GET', url: '/api/v1/stocks/035420/quote' });
  assert.equal(validButUnavailable.statusCode, 503);

  for (const path of ['quote', 'candles', 'summary']) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/stocks/000660/${path}` });
    assert.equal(response.statusCode, 200);
  }
});

test('API rate limit rejects requests above the configured window', async t => {
  const config = { ...loadConfig({ LOG_LEVEL: 'silent' }), rateLimitMax: 1 };
  const mock = new MockMarketDataProvider();
  const app = await buildApp(config, new MarketDataService(mock, mock));
  t.after(() => app.close());

  assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  const limited = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error.code, 'RATE_LIMITED');
});

test('health exposes safe provider and cache state without credential details', async t => {
  const config = loadConfig({
    LOG_LEVEL: 'silent',
    MARKET_DATA_API_KEY: 'must-never-appear',
    MARKET_DATA_APP_SECRET: 'also-private',
  });
  const mock = new MockMarketDataProvider();
  const app = await buildApp(config, new MarketDataService(mock, mock));
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/health' });
  const body = response.json();
  const serialized = JSON.stringify(body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.marketData.provider, 'alpha-twin-mock');
  assert.equal(body.marketData.cache, 'memory');
  assert.equal(serialized.includes('must-never-appear'), false);
  assert.equal(serialized.includes('also-private'), false);
  assert.equal(serialized.includes('marketDataApiKey'), false);
});

test('API trims valid symbols and rejects unsafe formats before provider calls', async t => {
  let calls = 0;
  const mock = new MockMarketDataProvider();
  const provider: MarketDataProvider = {
    id: 'validation-test', isFallback: false, dataMode: 'eod', priceAdjustment: 'unknown',
    async getQuote(symbol) {
      calls += 1;
      if (symbol === '999999') throw new MarketDataError('SYMBOL_NOT_FOUND', 'private upstream detail');
      const quote = await mock.getQuote('000660');
      return { ...quote, symbol, source: 'validation-test', fallback: false, dataMode: 'eod' };
    },
    async getDailyCandles(symbol, range) {
      calls += 1;
      return (await mock.getDailyCandles('000660', range)).map(candle => ({ ...candle, symbol }));
    },
  };
  const app = await buildApp(
    loadConfig({ LOG_LEVEL: 'silent' }),
    new MarketDataService(provider, mock, new MemoryCache(), false),
  );
  t.after(() => app.close());

  const trimmed = await app.inject({ method: 'GET', url: '/api/v1/stocks/%20000660%20/quote' });
  assert.equal(trimmed.statusCode, 200);
  assert.equal(trimmed.json().symbol, '000660');
  const callsAfterValid = calls;
  for (const symbol of ['660', '0006600', 'ABCDEF', "000660'", '-000660', '000660.0', '1%20OR%201=1']) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/stocks/${encodeURIComponent(symbol)}/quote` });
    assert.equal(response.statusCode, 400, symbol);
    assert.equal(response.json().error.code, 'INVALID_SYMBOL');
  }
  assert.equal(calls, callsAfterValid);

  const missing = await app.inject({ method: 'GET', url: '/api/v1/stocks/999999/quote' });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'SYMBOL_NOT_FOUND');
  assert.equal(JSON.stringify(missing.json()).includes('private upstream detail'), false);
});

test('cache keys isolate provider, operation, symbol, and range', async () => {
  const mock = new MockMarketDataProvider();
  let quoteCalls = 0;
  let candleCalls = 0;
  const provider: MarketDataProvider = {
    ...mock, id: 'isolated', isFallback: false,
    async getQuote(symbol) { quoteCalls += 1; return { ...(await mock.getQuote(symbol)), source: 'isolated' }; },
    async getDailyCandles(symbol, range) { candleCalls += 1; return mock.getDailyCandles(symbol, range); },
  };
  const service = new MarketDataService(provider, mock, new MemoryCache(), false);
  await Promise.all([
    service.getQuote('000660'), service.getQuote('005930'),
    service.getCandles('000660', '1m'), service.getCandles('000660', '3m'),
  ]);
  await Promise.all([
    service.getQuote('000660'), service.getQuote('005930'),
    service.getCandles('000660', '1m'), service.getCandles('000660', '3m'),
  ]);
  assert.equal(quoteCalls, 2);
  assert.equal(candleCalls, 2);
});

test('memory cache enforces stale expiry, bounded size, and safe replacement', async () => {
  let now = 0;
  const cache = new MemoryCacheStore(() => now, 2);
  await cache.set('a', { value: 1 }, 5, 10);
  await cache.set('b', { value: 2 }, 5, 10);
  await cache.set('a', { value: 3 }, 5, 10);
  await cache.set('c', { value: 4 }, 5, 10);
  assert.equal(cache.size, 2);
  assert.equal((await cache.get<{ value: number }>('a'))?.value.value, 3);
  assert.equal(await cache.get('b'), undefined);
  now = 11;
  await cache.clearExpired();
  assert.equal(cache.size, 0);
});

test('concurrent cache misses share one provider request and clear failed in-flight work', async () => {
  const mock = new MockMarketDataProvider();
  let calls = 0;
  let fail = false;
  const provider: MarketDataProvider = {
    ...mock, id: 'single-flight', isFallback: false,
    async getQuote(symbol) {
      calls += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      if (fail) throw new Error('temporary failure');
      return { ...(await mock.getQuote(symbol)), source: 'single-flight', fallback: false };
    },
    async getDailyCandles(symbol, range) { return mock.getDailyCandles(symbol, range); },
  };
  const service = new MarketDataService(provider, mock, new MemoryCache(), false);
  await Promise.all([service.getQuote('000660'), service.getQuote('000660'), service.getQuote('000660')]);
  assert.equal(calls, 1);

  const failingService = new MarketDataService(provider, mock, new MemoryCache(), false);
  fail = true;
  await assert.rejects(Promise.all([failingService.getQuote('005930'), failingService.getQuote('005930')]));
  fail = false;
  await failingService.getQuote('005930');
  assert.equal(calls, 3);
});

test('stale response metadata is copied without mutating the cached value', async () => {
  const mock = new MockMarketDataProvider();
  let now = 0;
  let fail = false;
  const provider: MarketDataProvider = {
    ...mock, id: 'copy-stale', isFallback: false,
    cachePolicy: { quoteTtlMs: 1, candlesTtlMs: 1, quoteStaleMaxAgeMs: 10, candlesStaleMaxAgeMs: 10 },
    async getQuote(symbol) {
      if (fail) throw new Error('failed');
      return { ...(await mock.getQuote(symbol)), source: 'copy-stale', stale: false, fallback: false };
    },
    async getDailyCandles(symbol, range) {
      if (fail) throw new Error('failed');
      return mock.getDailyCandles(symbol, range);
    },
  };
  const cache = new MemoryCache(() => now);
  const service = new MarketDataService(provider, mock, cache, false);
  const original = await service.getQuote('000660');
  now = 2;
  fail = true;
  const stale = await service.getQuote('000660');
  assert.equal(stale.stale, true);
  assert.equal(original.stale, false);
});

test('provider DTO validation failures are not cached', async () => {
  const mock = new MockMarketDataProvider();
  let calls = 0;
  const provider: MarketDataProvider = {
    ...mock, id: 'invalid-dto', isFallback: false,
    async getQuote(symbol) {
      calls += 1;
      const quote = await mock.getQuote(symbol);
      return calls === 1
        ? { ...quote, symbol: '999999', source: 'invalid-dto' }
        : { ...quote, source: 'invalid-dto', fallback: false };
    },
    async getDailyCandles(symbol, range) { return mock.getDailyCandles(symbol, range); },
  };
  const service = new MarketDataService(provider, mock, new MemoryCache(), false);
  await assert.rejects(service.getQuote('000660'), /invalid quote/);
  const quote = await service.getQuote('000660');
  assert.equal(quote.symbol, '000660');
  assert.equal(calls, 2);
});

test('stale entry is rechecked after a failed provider call', async () => {
  const mock = new MockMarketDataProvider();
  let now = 0;
  let fail = false;
  const provider: MarketDataProvider = {
    ...mock, id: 'expires-during-request', isFallback: false,
    cachePolicy: { quoteTtlMs: 1, candlesTtlMs: 1, quoteStaleMaxAgeMs: 10, candlesStaleMaxAgeMs: 10 },
    async getQuote(symbol) {
      if (fail) {
        now = 11;
        throw new Error('failed after stale limit');
      }
      return { ...(await mock.getQuote(symbol)), source: 'expires-during-request', fallback: false };
    },
    async getDailyCandles(symbol, range) { return mock.getDailyCandles(symbol, range); },
  };
  const service = new MarketDataService(provider, mock, new MemoryCache(() => now), true);
  await service.getQuote('000660');
  now = 2;
  fail = true;
  const fallback = await service.getQuote('000660');
  assert.equal(fallback.source, 'alpha-twin-mock');
  assert.equal(fallback.fallback, true);
});
