import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadConfig } from '../src/config.js';
import { mapPublicDataCandle, mapPublicDataQuote, publicDataDate } from '../src/providers/publicDataMapper.js';
import { PublicDataMarketDataProvider } from '../src/providers/publicDataMarketDataProvider.js';

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/public-data-stock-response.json', import.meta.url),
  'utf8',
)) as unknown;

function config(apiKey = 'test-service-key') {
  return loadConfig({
    MARKET_DATA_PROVIDER: 'public-data',
    MARKET_DATA_BASE_URL: 'https://example.test/stock-api',
    MARKET_DATA_API_KEY: apiKey,
    MARKET_DATA_TIMEOUT_MS: '20',
  });
}

function fixtureFetch(status = 200, payload: unknown = fixture): typeof fetch {
  return async () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('maps public data quote and candle numeric strings and KST trading date', () => {
  const item = {
    basDt: '20260710', srtnCd: '000660', itmsNm: 'SK하이닉스', mrktCtg: 'KOSPI',
    clpr: '178,400', vs: '-2,400', fltRt: '-1.36', mkp: '176,500', hipr: '180,000',
    lopr: '176,000', trqu: '3,812,450', trPrc: '684,291,080,000',
  };
  const quote = mapPublicDataQuote(item);
  const candle = mapPublicDataCandle(item);
  assert.equal(quote.price, 178400);
  assert.equal(quote.change, -2400);
  assert.equal(quote.tradingValue, 684291080000);
  assert.equal(quote.asOf, '2026-07-10');
  assert.equal(candle.volume, 3812450);
  assert.equal(candle.source, 'public-data-fsc');
});

test('mapper rejects empty, missing, invalid numeric, and invalid date fields', () => {
  const valid = {
    basDt: '20260710', srtnCd: '000660', itmsNm: 'SK하이닉스', mrktCtg: 'KOSPI',
    clpr: '178400', vs: '2400', fltRt: '1.36', mkp: '176500', hipr: '180000',
    lopr: '176000', trqu: '3812450', trPrc: '684291080000',
  };
  assert.throws(() => mapPublicDataQuote({ ...valid, itmsNm: '' }), /Invalid public data field/);
  assert.throws(() => mapPublicDataQuote({ ...valid, clpr: '' }), /Invalid numeric field/);
  assert.throws(() => mapPublicDataCandle({ ...valid, hipr: undefined }), /Invalid numeric field/);
  assert.throws(() => publicDataDate('20260230'), /Invalid public data field/);
});

test('returns latest confirmed quotes for the two enabled symbols', async () => {
  const provider = new PublicDataMarketDataProvider(config(), fixtureFetch(), () => new Date('2026-07-13T00:00:00Z'));
  const hynix = await provider.getQuote('000660');
  const samsung = await provider.getQuote('005930');
  assert.equal(hynix.price, 178400);
  assert.equal(hynix.asOf, '2026-07-10');
  assert.equal(samsung.price, 84200);
});

test('returns sorted, de-duplicated candles and sends all range parameters', async () => {
  let requestedUrl = '';
  const fetchImpl: typeof fetch = async input => {
    requestedUrl = String(input);
    return new Response(JSON.stringify(fixture), { status: 200 });
  };
  const provider = new PublicDataMarketDataProvider(config(), fetchImpl, () => new Date('2026-07-13T00:00:00Z'));
  const expectedBegins = {
    '1m': '20260613',
    '3m': '20260413',
    '6m': '20260113',
    '1y': '20250713',
  } as const;
  let oneMonth = [] as Awaited<ReturnType<typeof provider.getDailyCandles>>;
  for (const [range, expectedBegin] of Object.entries(expectedBegins)) {
    const candles = await provider.getDailyCandles('000660', range as keyof typeof expectedBegins);
    if (range === '1m') oneMonth = candles;
    const url = new URL(requestedUrl);
    assert.equal(url.searchParams.get('likeSrtnCd'), '000660');
    assert.equal(url.searchParams.get('beginBasDt'), expectedBegin);
    assert.equal(url.searchParams.get('endBasDt'), '20260714');
  }
  assert.deepEqual(oneMonth.map(item => item.date), ['2026-07-09', '2026-07-10']);
});

test('rejects unsupported symbols before making a request', async () => {
  let called = false;
  const provider = new PublicDataMarketDataProvider(config(), async () => {
    called = true;
    return new Response('{}');
  });
  await assert.rejects(provider.getQuote('035420'), /not enabled/);
  assert.equal(called, false);
});

test('handles missing credentials without exposing or calling the service', async () => {
  let called = false;
  const provider = new PublicDataMarketDataProvider(config(''), async () => {
    called = true;
    return new Response('{}');
  });
  await assert.rejects(provider.getQuote('000660'), error => {
    assert.equal(String(error).includes('serviceKey'), false);
    return true;
  });
  assert.equal(called, false);
});

test('normalizes rate-limit, server, empty, and rejected API responses', async () => {
  const rejectedPayload = { response: { header: { resultCode: '30', resultMsg: 'secret detail' } } };
  const emptyPayload = { response: { header: { resultCode: '00' }, body: { items: '' } } };
  await assert.rejects(new PublicDataMarketDataProvider(config(), fixtureFetch(429)).getQuote('000660'), /rate limit/);
  await assert.rejects(new PublicDataMarketDataProvider(config(), fixtureFetch(500)).getQuote('000660'), /temporarily unavailable/);
  await assert.rejects(new PublicDataMarketDataProvider(config(), fixtureFetch(200, emptyPayload)).getQuote('000660'), /No confirmed quote/);
  await assert.rejects(new PublicDataMarketDataProvider(config(), fixtureFetch(200, rejectedPayload)).getQuote('000660'), error => {
    assert.equal(String(error).includes('secret detail'), false);
    return true;
  });
});

test('aborts requests at the configured timeout', async () => {
  const hangingFetch: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  const provider = new PublicDataMarketDataProvider(config(), hangingFetch);
  await assert.rejects(provider.getQuote('000660'), /timed out/);
});
