import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MarketDataService } from '../src/marketDataService.js';
import { OpenDartError } from '../src/openDart/errors.js';
import { FinancialAccountNormalizer } from '../src/openDart/normalization/accountNormalizer.js';
import { OpenDartFinancialService } from '../src/openDart/openDartFinancialService.js';
import { MockMarketDataProvider } from '../src/providers/mockMarketDataProvider.js';
import {
  canonicalFinancialLines,
  financialStatementsDto,
  normalizationLine,
  NORMALIZATION_SYMBOL,
} from './fixtures/normalizedFinancial.js';

const normalizer = new FinancialAccountNormalizer();
const validQuery = 'businessYear=2026&reportCode=11013&fsDiv=CFS';
const normalizedUrl =
  `/api/v1/companies/${NORMALIZATION_SYMBOL}/financials/normalized?${validQuery}`;
const specificUrl = `/api/v1/companies/${NORMALIZATION_SYMBOL}/financials?${validQuery}`;

function marketData() {
  const mock = new MockMarketDataProvider();
  return new MarketDataService(mock, mock);
}

function financialService(
  load: () => ReturnType<OpenDartFinancialService['getFinancialStatements']>,
): OpenDartFinancialService {
  return {
    get status() { return { provider: 'synthetic', cache: 'none', cacheEntries: 0, events: {} }; },
    setLogger() {},
    getFinancialStatements: load,
  } as unknown as OpenDartFinancialService;
}

test('normalized route returns canonical summary while specific route keeps flat lines', async t => {
  const financial = financialService(async () => financialStatementsDto());
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData(), {
    openDartFinancial: financial,
    openDartFinancialNormalizer: normalizer,
  });
  t.after(() => app.close());
  const normalized = await app.inject({ method: 'GET', url: normalizedUrl });
  const specific = await app.inject({ method: 'GET', url: specificUrl });
  assert.equal(normalized.statusCode, 200);
  assert.equal(Object.keys(normalized.json().metrics).length, 8);
  assert.equal(normalized.json().metrics.totalAssets.status, 'resolved');
  assert.equal(specific.statusCode, 200);
  assert.equal(Array.isArray(specific.json().lines), true);
  assert.equal(specific.json().metrics, undefined);
});

test('normalized route reuses exact query validation before loading financial data', async t => {
  let calls = 0;
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData(), {
    openDartFinancial: financialService(async () => {
      calls += 1;
      return financialStatementsDto();
    }),
    openDartFinancialNormalizer: normalizer,
  });
  t.after(() => app.close());
  for (const url of [
    '/api/v1/companies/ABC/financials/normalized?businessYear=2026&reportCode=11013&fsDiv=CFS',
    `/api/v1/companies/${NORMALIZATION_SYMBOL}/financials/normalized`,
    `/api/v1/companies/${NORMALIZATION_SYMBOL}/financials/normalized?businessYear=2014&reportCode=11013&fsDiv=CFS`,
    `/api/v1/companies/${NORMALIZATION_SYMBOL}/financials/normalized?businessYear=2026&reportCode=latest&fsDiv=CFS`,
    `/api/v1/companies/${NORMALIZATION_SYMBOL}/financials/normalized?businessYear=2026&reportCode=11013&fsDiv=cfs`,
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 400, url);
  }
  assert.equal(calls, 0);
});

test('normalized route preserves OFS resolution and stale source metadata', async t => {
  const source = financialStatementsDto({
    requestedFsDiv: 'CFS',
    resolvedFsDiv: 'OFS',
    fallbackFromFsDiv: 'CFS',
    stale: true,
  });
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData(), {
    openDartFinancial: financialService(async () => source),
    openDartFinancialNormalizer: normalizer,
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: normalizedUrl });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().report.resolvedFsDiv, 'OFS');
  assert.equal(response.json().report.fallbackFromFsDiv, 'CFS');
  assert.equal(response.json().metadata.stale, true);
  assert.deepEqual(response.json().metadata.staleReasons, ['financial-statements-cache']);
  assert.equal(response.json().metadata.fallback, false);
});

test('normalized route forwards provider, mapping, missing report, and corp-code errors', async () => {
  const cases: Array<[OpenDartError, number]> = [
    [new OpenDartError('CORP_CODE_NOT_FOUND', 'financial-statements', false), 404],
    [new OpenDartError('FINANCIAL_REPORT_NOT_FOUND', 'financial-statements', false, '013'), 404],
    [new OpenDartError('OPENDART_UNAVAILABLE', 'financial-statements', true), 503],
    [new OpenDartError('FINANCIAL_RESPONSE_INCONSISTENT', 'financial-statements', false), 502],
  ];
  for (const [error, status] of cases) {
    const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData(), {
      openDartFinancial: financialService(async () => { throw error; }),
      openDartFinancialNormalizer: normalizer,
    });
    const response = await app.inject({ method: 'GET', url: normalizedUrl });
    await app.close();
    assert.equal(response.statusCode, status);
    assert.equal(response.json().error.code, error.code);
  }
});

test('unresolved and conflicting metrics are HTTP 200 domain states', async t => {
  const lines = canonicalFinancialLines().filter(line => line.accountId !== 'ifrs-full_Revenue');
  const operatingIncome = lines.find(line => line.accountId === 'dart_OperatingIncomeLoss')!;
  lines.push({
    ...operatingIncome,
    statementType: 'CIS',
    currentCumulativeAmount: '999',
  });
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData(), {
    openDartFinancial: financialService(async () => financialStatementsDto({ lines })),
    openDartFinancialNormalizer: normalizer,
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: normalizedUrl });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().metrics.revenue.status, 'unresolved');
  assert.equal(response.json().metrics.operatingIncome.status, 'conflict');
  assert.equal(response.json().metrics.operatingIncome.value, null);
});

test('normalized route requires configured dependencies and never leaks source-only fields', async t => {
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData());
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: normalizedUrl });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, 'OPENDART_NOT_CONFIGURED');

  const source = financialStatementsDto({
    lines: [normalizationLine({
      accountId: null,
      accountIdKind: 'missing',
      accountName: '자산총계',
    })],
  });
  const configured = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData(), {
    openDartFinancial: financialService(async () => source),
    openDartFinancialNormalizer: normalizer,
  });
  const safe = await configured.inject({ method: 'GET', url: normalizedUrl });
  await configured.close();
  assert.equal(safe.body.includes('previousAmount'), false);
  assert.equal(safe.body.includes('previousCumulativeAmount'), false);
  assert.equal(safe.body.includes('synthetic-request'), true);
});
