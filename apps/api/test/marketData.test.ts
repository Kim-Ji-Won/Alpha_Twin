import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import { MemoryCache } from '../src/cache.js';
import { loadConfig } from '../src/config.js';
import { CandleRange, StockCandleDto, StockQuoteDto } from '../src/contracts.js';
import { MarketDataService } from '../src/marketDataService.js';
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

test('API validates symbols and returns all market endpoints', async t => {
  const config = loadConfig({});
  const mock = new MockMarketDataProvider();
  const service = new MarketDataService(mock, mock);
  const app = await buildApp(config, service);
  t.after(() => app.close());

  const bad = await app.inject({ method: 'GET', url: '/api/v1/stocks/SK/quote' });
  assert.equal(bad.statusCode, 400);

  for (const path of ['quote', 'candles', 'summary']) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/stocks/000660/${path}` });
    assert.equal(response.statusCode, 200);
  }
});

test('API rate limit rejects requests above the configured window', async t => {
  const config = { ...loadConfig({}), rateLimitMax: 1 };
  const mock = new MockMarketDataProvider();
  const app = await buildApp(config, new MarketDataService(mock, mock));
  t.after(() => app.close());

  assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  const limited = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error.code, 'RATE_LIMITED');
});
