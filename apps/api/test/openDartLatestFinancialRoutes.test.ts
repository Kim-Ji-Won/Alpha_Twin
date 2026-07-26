import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MarketDataService } from '../src/marketDataService.js';
import { OpenDartError } from '../src/openDart/errors.js';
import { LatestFinancialReportResolutionDto } from '../src/openDart/latestFinancial/latestFinancialContracts.js';
import { LatestFinancialReportResolver } from '../src/openDart/latestFinancial/latestFinancialReportResolver.js';
import { LatestFinancialService } from '../src/openDart/latestFinancial/latestFinancialService.js';
import { FinancialAccountNormalizer } from '../src/openDart/normalization/accountNormalizer.js';
import { OpenDartFinancialService } from '../src/openDart/openDartFinancialService.js';
import { MockMarketDataProvider } from '../src/providers/mockMarketDataProvider.js';
import {
  LATEST_CORP_CODE,
  LATEST_SYMBOL,
} from './fixtures/latestFinancial.js';
import {
  NORMALIZATION_RECEIPT,
  canonicalFinancialLines,
  financialStatementsDto,
} from './fixtures/normalizedFinancial.js';

const rawUrl = `/api/v1/companies/${LATEST_SYMBOL}/financials/latest`;
const normalizedUrl =
  `/api/v1/companies/${LATEST_SYMBOL}/financials/normalized/latest`;

function marketData() {
  const mock = new MockMarketDataProvider();
  return new MarketDataService(mock, mock);
}

function resolution(
  overrides: Partial<LatestFinancialReportResolutionDto> = {},
): LatestFinancialReportResolutionDto {
  return {
    symbol: LATEST_SYMBOL,
    corpCode: LATEST_CORP_CODE,
    businessYear: '2026',
    reportCode: '11013',
    periodKind: 'Q1',
    disclosureDetailType: 'A003',
    periodEnd: '2026-03',
    fiscalYearEndMonth: 12,
    filing: {
      receiptNumber: NORMALIZATION_RECEIPT,
      receiptDate: '2026-05-15',
      reportName: '분기보고서 (2026.03)',
      correctionType: 'none',
    },
    resolutionMethod: 'opendart-final-periodic-disclosure',
    metadata: {
      source: 'opendart-fss',
      retrievedAt: '2026-07-26T00:00:00.000Z',
      stale: false,
      staleReasons: [],
      fallback: false,
    },
    ...overrides,
  };
}

function resolverStub(
  load: () => Promise<LatestFinancialReportResolutionDto>,
): LatestFinancialReportResolver {
  return {
    get status() {
      return { provider: 'opendart-fss', cache: 'none', cacheEntries: 0, events: {} };
    },
    setLogger() {},
    resolve: load,
  } as unknown as LatestFinancialReportResolver;
}

function financialStub(
  load: OpenDartFinancialService['getFinancialStatements'],
): OpenDartFinancialService {
  return {
    get status() {
      return { provider: 'opendart-fss', cache: 'none', cacheEntries: 0, events: {} };
    },
    setLogger() {},
    getFinancialStatements: load,
  } as unknown as OpenDartFinancialService;
}

function latestService(
  resolve: () => Promise<LatestFinancialReportResolutionDto> =
    async () => resolution(),
  financial: OpenDartFinancialService['getFinancialStatements'] =
    async () => financialStatementsDto(),
) {
  return new LatestFinancialService(
    resolverStub(resolve),
    financialStub(financial),
    new FinancialAccountNormalizer(),
  );
}

test('latest routes validate symbol and accept only optional uppercase fsDiv', async t => {
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData());
  t.after(() => app.close());
  for (const url of [
    '/api/v1/companies/ABC/financials/latest',
    `${rawUrl}?fsDiv=cfs`,
    `${rawUrl}?fsDiv=`,
    `${rawUrl}?businessYear=2026`,
    `${normalizedUrl}?reportCode=latest`,
  ]) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 400, url);
  }
});

test('latest raw route defaults to CFS and supports direct OFS', async t => {
  const calls: Array<{ businessYear: string; reportCode: string; fsDiv: string }> = [];
  const service = latestService(
    undefined,
    async (_symbol, query) => {
      calls.push(query);
      return financialStatementsDto({
        requestedFsDiv: query.fsDiv,
        resolvedFsDiv: query.fsDiv,
      });
    },
  );
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData(), {
    latestFinancial: service,
  });
  t.after(() => app.close());
  const cfs = await app.inject({ method: 'GET', url: rawUrl });
  const ofs = await app.inject({ method: 'GET', url: `${rawUrl}?fsDiv=OFS` });
  assert.equal(cfs.statusCode, 200);
  assert.equal(ofs.statusCode, 200);
  assert.deepEqual(calls, [
    { businessYear: '2026', reportCode: '11013', fsDiv: 'CFS' },
    { businessYear: '2026', reportCode: '11013', fsDiv: 'OFS' },
  ]);
  assert.equal(cfs.json().resolution.filing.receiptNumber, NORMALIZATION_RECEIPT);
  assert.equal(Array.isArray(cfs.json().financials.lines), true);
});

test('latest normalized route returns resolution plus summary and preserves OFS metadata', async t => {
  const service = latestService(
    undefined,
    async () => financialStatementsDto({
      requestedFsDiv: 'CFS',
      resolvedFsDiv: 'OFS',
      fallbackFromFsDiv: 'CFS',
      stale: true,
    }),
  );
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData(), {
    latestFinancial: service,
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: normalizedUrl });
  assert.equal(response.statusCode, 200);
  assert.equal(Object.keys(response.json().summary.metrics).length, 8);
  assert.equal(response.json().summary.report.resolvedFsDiv, 'OFS');
  assert.equal(response.json().summary.metadata.stale, true);
  assert.equal(response.json().resolution.disclosureDetailType, 'A003');
});

test('normalized metric unresolved and conflict remain HTTP 200', async () => {
  const unresolvedLines = canonicalFinancialLines().filter(
    line => line.accountId !== 'ifrs-full_Revenue',
  );
  const conflictLines = canonicalFinancialLines();
  const revenue = conflictLines.find(line => line.accountId === 'ifrs-full_Revenue')!;
  conflictLines.push({
    ...revenue,
    statementType: 'CIS',
    currentCumulativeAmount: '999',
  });
  for (const [lines, expected] of [
    [unresolvedLines, 'unresolved'],
    [conflictLines, 'conflict'],
  ] as const) {
    const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData(), {
      latestFinancial: latestService(
        undefined,
        async () => financialStatementsDto({ lines: [...lines] }),
      ),
    });
    const response = await app.inject({ method: 'GET', url: normalizedUrl });
    await app.close();
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().summary.metrics.revenue.status, expected);
  }
});

test('receipt mismatch is 502 and normalization never proceeds', async t => {
  const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData(), {
    latestFinancial: latestService(
      async () => resolution({
        filing: {
          ...resolution().filing,
          receiptNumber: '20260515009999',
        },
      }),
    ),
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: normalizedUrl });
  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.code, 'LATEST_FINANCIAL_REPORT_RECEIPT_MISMATCH');
});

test('latest routes preserve resolver and financial error semantics without older fallback', async () => {
  const cases: Array<[() => LatestFinancialService, number, string]> = [
    [
      () => latestService(async () => {
        throw new OpenDartError(
          'CORP_CODE_NOT_FOUND',
          'latest-financial-report',
          false,
        );
      }),
      404,
      'CORP_CODE_NOT_FOUND',
    ],
    [
      () => latestService(async () => {
        throw new OpenDartError(
          'LATEST_FINANCIAL_REPORT_NOT_FOUND',
          'latest-financial-report',
          false,
        );
      }),
      404,
      'LATEST_FINANCIAL_REPORT_NOT_FOUND',
    ],
    [
      () => latestService(async () => {
        throw new OpenDartError(
          'LATEST_FINANCIAL_REPORT_UNRESOLVED',
          'latest-financial-report',
          false,
        );
      }),
      502,
      'LATEST_FINANCIAL_REPORT_UNRESOLVED',
    ],
    [
      () => latestService(async () => {
        throw new OpenDartError(
          'OPENDART_UNAVAILABLE',
          'latest-financial-report',
          true,
        );
      }),
      503,
      'OPENDART_UNAVAILABLE',
    ],
    [
      () => latestService(
        undefined,
        async () => {
          throw new OpenDartError(
            'FINANCIAL_REPORT_NOT_FOUND',
            'financial-statements',
            false,
            '013',
          );
        },
      ),
      404,
      'FINANCIAL_REPORT_NOT_FOUND',
    ],
  ];
  for (const [makeService, status, code] of cases) {
    const app = await buildApp(loadConfig({ LOG_LEVEL: 'silent' }), marketData(), {
      latestFinancial: makeService(),
    });
    const response = await app.inject({ method: 'GET', url: rawUrl });
    await app.close();
    assert.equal(response.statusCode, status);
    assert.equal(response.json().error.code, code);
  }
});
