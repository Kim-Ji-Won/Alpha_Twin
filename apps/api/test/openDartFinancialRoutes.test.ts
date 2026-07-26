import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import { MemoryCacheStore } from '../src/cache.js';
import { loadConfig } from '../src/config.js';
import { MarketDataService } from '../src/marketDataService.js';
import { CorpCodeArchiveParser } from '../src/openDart/corpCode/corpCodeArchiveParser.js';
import { createCorpCodeSnapshot } from '../src/openDart/corpCode/corpCodeIndexStore.js';
import { CorpCodeResolver } from '../src/openDart/corpCode/corpCodeResolver.js';
import { CorpCodeRecord } from '../src/openDart/contracts.js';
import { OpenDartError } from '../src/openDart/errors.js';
import {
  OPENDART_FINANCIAL_CACHE_POLICY,
  OpenDartFinancialService,
} from '../src/openDart/openDartFinancialService.js';
import { FinancialStatementProvider } from '../src/openDart/providers/financialStatementProvider.js';
import { MockMarketDataProvider } from '../src/providers/mockMarketDataProvider.js';
import {
  financialResponse,
  financialRow,
  noFinancialData,
  SYNTHETIC_CORP_CODE,
  SYNTHETIC_SYMBOL,
} from './fixtures/openDartFinancial.js';

const now = new Date('2026-07-26T00:00:00Z');
const record: CorpCodeRecord = {
  corpCode: SYNTHETIC_CORP_CODE,
  corpName: '합성기업',
  corpEngName: 'Synthetic',
  stockCode: SYNTHETIC_SYMBOL,
  companyInfoModifiedDate: '2026-07-01',
};
const validUrl = `/api/v1/companies/${SYNTHETIC_SYMBOL}/financials?businessYear=2026&reportCode=11013&fsDiv=CFS`;

function marketData() {
  const mock = new MockMarketDataProvider();
  return new MarketDataService(mock, mock);
}

function resolver(records: CorpCodeRecord[] = [record]) {
  const snapshot = createCorpCodeSnapshot(records, now.toISOString());
  const store = { async load() { return snapshot; }, async save() {} };
  const source = { async fetchArchive(): Promise<Buffer> { throw new Error('not used'); } };
  const parser = { async parse(): Promise<CorpCodeRecord[]> { return records; } } as CorpCodeArchiveParser;
  return new CorpCodeResolver(source, parser, store, () => now);
}

function service(
  provider: FinancialStatementProvider,
  records: CorpCodeRecord[] = [record],
) {
  return new OpenDartFinancialService(
    resolver(records),
    provider,
    new MemoryCacheStore(),
    () => now,
  );
}

test('financial route validates symbol and every required specific query before provider use', async t => {
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData());
  t.after(() => app.close());
  const cases: Array<[string, string]> = [
    ['/api/v1/companies/ABC/financials?businessYear=2026&reportCode=11013&fsDiv=CFS', 'INVALID_SYMBOL'],
    [`/api/v1/companies/${SYNTHETIC_SYMBOL}/financials`, 'INVALID_FINANCIAL_QUERY'],
    [`/api/v1/companies/${SYNTHETIC_SYMBOL}/financials?businessYear=2014&reportCode=11013&fsDiv=CFS`, 'INVALID_FINANCIAL_QUERY'],
    [`/api/v1/companies/${SYNTHETIC_SYMBOL}/financials?businessYear=2027&reportCode=11013&fsDiv=CFS`, 'INVALID_FINANCIAL_QUERY'],
    [`/api/v1/companies/${SYNTHETIC_SYMBOL}/financials?businessYear=2026&reportCode=latest&fsDiv=CFS`, 'INVALID_FINANCIAL_QUERY'],
    [`/api/v1/companies/${SYNTHETIC_SYMBOL}/financials?businessYear=2026&reportCode=11013&fsDiv=cfs`, 'INVALID_FINANCIAL_QUERY'],
  ];
  for (const [url, code] of cases) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 400, url);
    assert.equal(response.json().error.code, code);
  }
});

test('financial route returns safe 503 when the OpenDART financial service is absent', async t => {
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData());
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: validUrl });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, 'OPENDART_NOT_CONFIGURED');
});

test('financial route returns flat DTO and CFS to OFS resolution metadata', async t => {
  const calls: string[] = [];
  const financial = service({
    async getFinancialStatements(input) {
      calls.push(input.fsDiv);
      return input.fsDiv === 'CFS' ? noFinancialData() : financialResponse();
    },
  });
  const app = await buildApp(
    loadConfig({ LOG_LEVEL: 'silent' }),
    marketData(),
    { openDartFinancial: financial },
  );
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: validUrl });
  const body = response.json();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, ['CFS', 'OFS']);
  assert.equal(body.report.requestedFsDiv, 'CFS');
  assert.equal(body.report.resolvedFsDiv, 'OFS');
  assert.equal(body.report.fallbackFromFsDiv, 'CFS');
  assert.equal(Array.isArray(body.lines), true);
  assert.equal(typeof body.lines[0].currentAmount, 'string');
  assert.equal(body.metadata.fallback, false);
});

test('financial route maps missing corp/report, unavailable provider, and malformed data', async () => {
  const cases: Array<[OpenDartFinancialService, number, string]> = [
    [service({ async getFinancialStatements() { return financialResponse(); } }, []), 404, 'CORP_CODE_NOT_FOUND'],
    [service({ async getFinancialStatements() { return noFinancialData(); } }), 404, 'FINANCIAL_REPORT_NOT_FOUND'],
    [service({ async getFinancialStatements() { throw new OpenDartError('OPENDART_UNAVAILABLE', 'financial-statements', true); } }), 503, 'OPENDART_UNAVAILABLE'],
    [service({ async getFinancialStatements() { return financialResponse([financialRow({ thstrm_amount: '1.2' })]); } }), 502, 'FINANCIAL_ACCOUNT_VALUE_INVALID'],
  ];
  for (const [financial, status, code] of cases) {
    const app = await buildApp(
      loadConfig({ LOG_LEVEL: 'silent' }),
      marketData(),
      { openDartFinancial: financial },
    );
    const response = await app.inject({ method: 'GET', url: validUrl });
    await app.close();
    assert.equal(response.statusCode, status);
    assert.equal(response.json().error.code, code);
  }
});

test('financial route returns same-query stale data only after provider availability failure', async t => {
  let millis = now.getTime();
  let fail = false;
  const financial = new OpenDartFinancialService(
    resolver(),
    {
      async getFinancialStatements() {
        if (fail) {
          throw new OpenDartError(
            'OPENDART_UNAVAILABLE',
            'financial-statements',
            true,
          );
        }
        return financialResponse();
      },
    },
    new MemoryCacheStore(() => millis),
    () => new Date(millis),
  );
  await financial.getFinancialStatements(SYNTHETIC_SYMBOL, {
    businessYear: '2026',
    reportCode: '11013',
    fsDiv: 'CFS',
  });
  millis += OPENDART_FINANCIAL_CACHE_POLICY.freshMs + 1;
  fail = true;

  const app = await buildApp(
    loadConfig({ LOG_LEVEL: 'silent' }),
    marketData(),
    { openDartFinancial: financial },
  );
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: validUrl });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().metadata.stale, true);
  assert.deepEqual(
    response.json().metadata.staleReasons,
    ['financial-statements-cache'],
  );
});

test('financial responses never expose provider secrets, URLs, messages, or raw fields', async t => {
  const secret = 'synthetic-secret-never-expose';
  const baseUrl = 'https://private.example.test';
  const financial = service({
    async getFinancialStatements() {
      return {
        ...financialResponse(),
        message: secret,
        private_provider_url: baseUrl,
        crtfc_key: secret,
      };
    },
  });
  const app = await buildApp(
    loadConfig({
      LOG_LEVEL: 'silent',
      OPENDART_API_KEY: secret,
      OPENDART_BASE_URL: baseUrl,
    }),
    marketData(),
    { openDartFinancial: financial },
  );
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: validUrl });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes(secret), false);
  assert.equal(response.body.includes(baseUrl), false);
  assert.equal(response.body.includes('crtfc_key'), false);
  assert.equal(response.body.includes('synthetic success'), false);
});
