import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadConfig } from '../src/config.js';
import { businessDaysBetween, calculateEodQueryRange, classifyEodFreshness, getKstDateString } from '../src/marketDate.js';
import { mapPublicDataCandle, mapPublicDataQuote, publicDataDate } from '../src/providers/publicDataMapper.js';
import {
  PUBLIC_DATA_MAX_PAGES,
  PublicDataMarketDataProvider,
  normalizePublicDataPage,
} from '../src/providers/publicDataMarketDataProvider.js';

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

function pagePayload(
  items: Array<Record<string, unknown>>,
  pageNo = 1,
  totalCount = items.length,
  numOfRows = 100,
): unknown {
  return {
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' },
      body: { items: { item: items }, pageNo, numOfRows, totalCount },
    },
  };
}

function stockItem(symbol: string, date: string, close = '100000'): Record<string, unknown> {
  return {
    basDt: date, srtnCd: symbol, itmsNm: `종목 ${symbol}`, mrktCtg: 'KOSPI',
    clpr: close, vs: '100', fltRt: '0.1', mkp: close, hipr: close,
    lopr: close, trqu: '1000', trPrc: '100000000',
  };
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

test('accepts any valid six-digit symbol and uses response metadata', async () => {
  let called = false;
  const provider = new PublicDataMarketDataProvider(config(), async input => {
    called = true;
    const symbol = new URL(String(input)).searchParams.get('likeSrtnCd') ?? '';
    return new Response(JSON.stringify(pagePayload([stockItem(symbol, '20260710')])));
  });
  const quote = await provider.getQuote('035420');
  assert.equal(quote.symbol, '035420');
  assert.equal(quote.dataMode, 'eod');
  assert.equal(quote.priceAdjustment, 'unknown');
  assert.equal(called, true);
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
  const emptyPayload = pagePayload([], 1, 0);
  await assert.rejects(new PublicDataMarketDataProvider(config(), fixtureFetch(429)).getQuote('000660'), /rate limit/);
  await assert.rejects(new PublicDataMarketDataProvider(config(), fixtureFetch(500)).getQuote('000660'), /temporarily unavailable/);
  await assert.rejects(new PublicDataMarketDataProvider(config(), fixtureFetch(200, emptyPayload)).getQuote('000660'), /not found/);
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

test('rejects malformed symbols before any external request', async () => {
  let calls = 0;
  const provider = new PublicDataMarketDataProvider(config(), async () => {
    calls += 1;
    return new Response('{}');
  });
  for (const symbol of ['660', '0006600', 'ABCDEF', "000660'", '../../', '-00660', '000660.0', ' 000660 ']) {
    await assert.rejects(provider.getQuote(symbol), /six digits/);
  }
  assert.equal(calls, 0);
});

test('returns SYMBOL_NOT_FOUND only after bounded empty searches', async () => {
  let calls = 0;
  const provider = new PublicDataMarketDataProvider(config(), async () => {
    calls += 1;
    return new Response(JSON.stringify(pagePayload([], 1, 0)));
  });
  await assert.rejects(provider.getQuote('999999'), error => {
    assert.equal((error as { code?: string }).code, 'SYMBOL_NOT_FOUND');
    return true;
  });
  assert.equal(calls, 2);
});

test('collects multiple pages, then sorts and de-duplicates trading dates', async () => {
  const requestedPages: string[] = [];
  const fetchImpl: typeof fetch = async input => {
    const pageNo = new URL(String(input)).searchParams.get('pageNo') ?? '';
    requestedPages.push(pageNo);
    const items = pageNo === '1'
      ? [stockItem('035420', '20260710', '102000'), stockItem('035420', '20260708', '100000')]
      : [stockItem('035420', '20260709', '101000'), stockItem('035420', '20260710', '103000')];
    return new Response(JSON.stringify(pagePayload(items, Number(pageNo), 4, 2)));
  };
  const provider = new PublicDataMarketDataProvider(config(), fetchImpl, () => new Date('2026-07-13T00:00:00Z'));
  const candles = await provider.getDailyCandles('035420', '1m');
  assert.deepEqual(requestedPages, ['1', '2']);
  assert.deepEqual(candles.map(candle => candle.date), ['2026-07-08', '2026-07-09', '2026-07-10']);
  assert.equal(candles.at(-1)?.close, 103000);
});

test('rejects invalid, repeated, empty, inconsistent, and over-limit pagination', async () => {
  assert.throws(() => normalizePublicDataPage(pagePayload([], 0, 0)), /pageNo/);
  assert.throws(() => normalizePublicDataPage(pagePayload([], 1, 0, Number.NaN)), /numOfRows/);

  const scenarios: Array<{ name: string; fetch: typeof fetch; pattern: RegExp }> = [
    {
      name: 'repeated page number',
      fetch: async () => new Response(JSON.stringify(pagePayload([stockItem('000660', '20260710')], 1, 2, 1))),
      pattern: /repeated a page|did not advance/,
    },
    {
      name: 'repeated page content',
      fetch: async input => {
        const page = Number(new URL(String(input)).searchParams.get('pageNo'));
        return new Response(JSON.stringify(pagePayload([stockItem('000660', '20260710')], page, 2, 1)));
      },
      pattern: /repeated a page/,
    },
    {
      name: 'empty intermediate page',
      fetch: async input => {
        const page = Number(new URL(String(input)).searchParams.get('pageNo'));
        return new Response(JSON.stringify(pagePayload(page === 1 ? [stockItem('000660', '20260710')] : [], page, 3, 1)));
      },
      pattern: /incomplete page/,
    },
    {
      name: 'changed total count',
      fetch: async input => {
        const page = Number(new URL(String(input)).searchParams.get('pageNo'));
        return new Response(JSON.stringify(pagePayload([stockItem('000660', `202607${10 + page}`)], page, page === 1 ? 3 : 4, 1)));
      },
      pattern: /metadata changed/,
    },
  ];
  for (const scenario of scenarios) {
    const provider = new PublicDataMarketDataProvider(config(), scenario.fetch);
    await assert.rejects(provider.getDailyCandles('000660', '1m'), scenario.pattern, scenario.name);
  }

  const tooManyRows = Array.from({ length: 2_001 }, (_, index) => stockItem('000660', `row-${index}`));
  await assert.rejects(
    new PublicDataMarketDataProvider(config(), fixtureFetch(200, pagePayload(tooManyRows, 1, 2_001, 2_001)))
      .getDailyCandles('000660', '1m'),
    /row limit/,
  );

  const tooManyPages = new PublicDataMarketDataProvider(config(), async input => {
    const page = Number(new URL(String(input)).searchParams.get('pageNo'));
    return new Response(JSON.stringify(pagePayload([stockItem('000660', `2026${String(page).padStart(4, '0')}`)], page, PUBLIC_DATA_MAX_PAGES + 1, 1)));
  });
  await assert.rejects(tooManyPages.getDailyCandles('000660', '1m'), /page limit/);
});

test('fails the whole operation when a later page times out, rate-limits, or returns 5xx', async () => {
  for (const status of [429, 500]) {
    const provider = new PublicDataMarketDataProvider(config(), async input => {
      const page = Number(new URL(String(input)).searchParams.get('pageNo'));
      return page === 1
        ? new Response(JSON.stringify(pagePayload([stockItem('000660', '20260710')], 1, 2, 1)))
        : new Response('{}', { status });
    });
    await assert.rejects(provider.getDailyCandles('000660', '1m'), status === 429 ? /rate limit/ : /temporarily unavailable/);
  }

  const timeoutProvider = new PublicDataMarketDataProvider(config(), async (input, init) => {
    const page = Number(new URL(String(input)).searchParams.get('pageNo'));
    if (page === 1) return new Response(JSON.stringify(pagePayload([stockItem('000660', '20260710')], 1, 2, 1)));
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });
  await assert.rejects(timeoutProvider.getDailyCandles('000660', '1m'), /timed out/);
});

test('uses KST date-only arithmetic and tolerates weekends for EOD freshness', () => {
  assert.equal(getKstDateString(new Date('2026-07-19T15:30:00Z')), '2026-07-20');
  assert.deepEqual(calculateEodQueryRange(new Date('2026-03-31T12:00:00Z'), 1), {
    begin: '2026-02-28',
    end: '2026-04-01',
  });
  assert.equal(businessDaysBetween('2026-07-17', '2026-07-20'), 1);
  assert.equal(classifyEodFreshness('2026-07-16', new Date('2026-07-20T00:00:00Z')), 'recent');
  assert.equal(publicDataDate('20260720'), '2026-07-20');
});
