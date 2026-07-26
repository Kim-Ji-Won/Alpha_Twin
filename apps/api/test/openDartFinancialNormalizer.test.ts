import assert from 'node:assert/strict';
import test from 'node:test';

import { FinancialAccountNormalizer } from '../src/openDart/normalization/accountNormalizer.js';
import {
  CANONICAL_FINANCIAL_METRICS,
  CANONICAL_FINANCIAL_REGISTRY,
} from '../src/openDart/normalization/canonicalFinancialMetrics.js';
import {
  canonicalFinancialLines,
  financialStatementsDto,
  NORMALIZATION_RECEIPT,
  normalizationLine,
} from './fixtures/normalizedFinancial.js';

const normalizer = new FinancialAccountNormalizer();

test('canonical registry defines exactly eight metrics with strict statement boundaries', () => {
  assert.deepEqual(
    CANONICAL_FINANCIAL_REGISTRY.map(definition => definition.metric),
    CANONICAL_FINANCIAL_METRICS,
  );
  assert.equal(CANONICAL_FINANCIAL_REGISTRY.length, 8);
  assert.deepEqual(
    CANONICAL_FINANCIAL_REGISTRY.map(definition => definition.standardAccountIds.length),
    [1, 1, 1, 1, 1, 1, 1, 1],
  );
  assert.deepEqual(
    Object.fromEntries(CANONICAL_FINANCIAL_REGISTRY.map(definition => [
      definition.metric,
      definition.allowedStatementTypes,
    ])),
    {
      totalAssets: ['BS'],
      totalLiabilities: ['BS'],
      totalEquity: ['BS'],
      cashAndCashEquivalents: ['BS'],
      revenue: ['IS', 'CIS'],
      operatingIncome: ['IS', 'CIS'],
      netIncome: ['IS', 'CIS'],
      operatingCashFlow: ['CF'],
    },
  );
});

test('normalizer resolves all eight standard IDs and preserves complete evidence', () => {
  const summary = normalizer.normalize(financialStatementsDto());
  for (const metric of CANONICAL_FINANCIAL_METRICS) {
    const result = summary.metrics[metric];
    assert.equal(result.status, 'resolved', metric);
    if (result.status !== 'resolved') continue;
    assert.equal(result.matchedBy, 'standard-account-id');
    assert.equal(result.evidence.receiptNumber, NORMALIZATION_RECEIPT);
    assert.equal(result.evidence.accountIdKind, 'standard');
    assert.equal(result.evidence.currency, 'KRW');
    assert.equal(result.currency, 'KRW');
    assert.equal(typeof result.value, 'string');
  }
  assert.equal(summary.metrics.totalAssets.status === 'resolved'
    && summary.metrics.totalAssets.value, '9007199254740993');
  assert.equal(summary.metrics.operatingIncome.status === 'resolved'
    && summary.metrics.operatingIncome.value, '-130');
  assert.equal(summary.metrics.operatingCashFlow.status === 'resolved'
    && summary.metrics.operatingCashFlow.evidence.sourceField, 'currentAmount');
});

test('unsupported statements and fuzzy partial names never resolve a metric', () => {
  const summary = normalizer.normalize(financialStatementsDto({
    lines: [
      normalizationLine({
        statementType: 'CF',
        accountId: 'ifrs-full_ProfitLoss',
        accountName: '분기순이익',
        currentCumulativeAmount: '100',
      }),
      normalizationLine({
        statementType: 'IS',
        accountId: null,
        accountIdKind: 'missing',
        accountName: '연결 매출액',
        currentCumulativeAmount: '200',
      }),
    ],
  }));
  assert.equal(summary.metrics.netIncome.status, 'unresolved');
  assert.equal(summary.metrics.revenue.status, 'unresolved');
  assert.equal(summary.metrics.netIncome.status === 'unresolved'
    && summary.metrics.netIncome.reason, 'account-not-found');
});

test('match ranking prefers standard ID, then approved ID alias, then exact name alias', () => {
  const definitions = CANONICAL_FINANCIAL_REGISTRY.map(definition =>
    definition.metric === 'revenue'
      ? { ...definition, approvedAccountIdAliases: ['synthetic_RevenueAlias'] }
      : definition);
  const ranked = new FinancialAccountNormalizer(definitions);
  const standard = normalizationLine({
    statementType: 'IS',
    accountId: 'ifrs-full_Revenue',
    accountName: '다른 표시명',
    currentCumulativeAmount: '300',
  });
  const idAlias = normalizationLine({
    statementType: 'CIS',
    accountId: 'synthetic_RevenueAlias',
    accountIdKind: 'unknown',
    accountName: '합성 수익',
    currentCumulativeAmount: '200',
  });
  const nameAlias = normalizationLine({
    statementType: 'IS',
    accountId: null,
    accountIdKind: 'missing',
    accountName: '매출액',
    currentCumulativeAmount: '100',
  });
  let revenue = ranked.normalize(financialStatementsDto({
    lines: [nameAlias, idAlias, standard],
  })).metrics.revenue;
  assert.equal(revenue.status === 'resolved' && revenue.value, '300');
  assert.equal(revenue.status === 'resolved' && revenue.matchedBy, 'standard-account-id');
  revenue = ranked.normalize(financialStatementsDto({
    lines: [nameAlias, idAlias],
  })).metrics.revenue;
  assert.equal(revenue.status === 'resolved' && revenue.value, '200');
  assert.equal(revenue.status === 'resolved' && revenue.matchedBy, 'approved-account-id-alias');
});

test('exact names support missing or marker IDs but never unapproved unknown IDs', () => {
  const summary = normalizer.normalize(financialStatementsDto({
    lines: [
      normalizationLine({
        statementType: 'IS',
        accountId: null,
        accountIdKind: 'standard-code-unused',
        accountName: '매출액',
        currentCumulativeAmount: '100',
      }),
      normalizationLine({
        statementType: 'CIS',
        accountId: null,
        accountIdKind: 'missing',
        accountName: '영업이익',
        currentCumulativeAmount: '20',
      }),
      normalizationLine({
        statementType: 'CIS',
        accountId: 'entity_ProfitLoss',
        accountIdKind: 'unknown',
        accountName: '분기순이익',
        currentCumulativeAmount: '10',
      }),
    ],
  }));
  assert.equal(summary.metrics.revenue.status === 'resolved'
    && summary.metrics.revenue.matchedBy, 'approved-account-name-alias');
  assert.equal(summary.metrics.operatingIncome.status, 'resolved');
  assert.equal(summary.metrics.netIncome.status, 'unresolved');
});

test('IS and CIS equivalent standard candidates dedupe deterministically by statement', () => {
  const lines = canonicalFinancialLines();
  const revenue = lines.find(line => line.accountId === 'ifrs-full_Revenue')!;
  lines.push({ ...revenue, statementType: 'CIS', statementName: '합성 포괄손익계산서' });
  const summary = normalizer.normalize(financialStatementsDto({ lines }));
  const result = summary.metrics.revenue;
  assert.equal(result.status, 'resolved');
  assert.equal(result.status === 'resolved' && result.evidence.statementType, 'IS');
  assert.deepEqual(
    summary.warnings.find(warning => warning.code === 'DUPLICATE_EQUIVALENT_CANDIDATE')?.metrics,
    ['revenue'],
  );
});

test('different values, currencies, and dimensions produce explicit conflicts', () => {
  const lines = canonicalFinancialLines();
  const revenue = lines.find(line => line.accountId === 'ifrs-full_Revenue')!;
  const operatingIncome = lines.find(line => line.accountId === 'dart_OperatingIncomeLoss')!;
  const assets = lines.find(line => line.accountId === 'ifrs-full_Assets')!;
  lines.push(
    { ...revenue, statementType: 'CIS', currentCumulativeAmount: '999' },
    { ...operatingIncome, statementType: 'CIS', currency: 'USD' },
    { ...assets, accountDetail: 'member=synthetic', currentAmount: '1' },
  );
  const summary = normalizer.normalize(financialStatementsDto({ lines }));
  assert.equal(summary.metrics.revenue.status === 'conflict'
    && summary.metrics.revenue.reason, 'value-conflict');
  assert.equal(summary.metrics.operatingIncome.status === 'conflict'
    && summary.metrics.operatingIncome.reason, 'value-conflict');
  assert.equal(summary.metrics.totalAssets.status === 'conflict'
    && summary.metrics.totalAssets.reason, 'dimension-conflict');
  assert.equal(JSON.stringify(summary.metrics.revenue).includes('999'), false);
});

test('H1 and Q3 select cumulative income while FY selects annual current amount', () => {
  for (const periodKind of ['H1', 'Q3'] as const) {
    const summary = normalizer.normalize(financialStatementsDto({ periodKind }));
    const revenue = summary.metrics.revenue;
    assert.equal(revenue.status === 'resolved' && revenue.value, '1300');
    assert.equal(revenue.status === 'resolved' && revenue.basis, 'current-cumulative');
    assert.equal(revenue.status === 'resolved'
      && revenue.evidence.sourceField, 'currentCumulativeAmount');
    const cashFlow = summary.metrics.operatingCashFlow;
    assert.equal(cashFlow.status === 'resolved' && cashFlow.basis, 'current-cumulative');
    assert.equal(cashFlow.status === 'resolved'
      && cashFlow.evidence.sourceField, 'currentAmount');
  }
  const annual = normalizer.normalize(financialStatementsDto({ periodKind: 'FY' }));
  assert.equal(annual.metrics.revenue.status === 'resolved'
    && annual.metrics.revenue.value, '300');
  assert.equal(annual.metrics.revenue.status === 'resolved'
    && annual.metrics.revenue.basis, 'current-period');
  assert.equal(annual.metrics.operatingCashFlow.status === 'resolved'
    && annual.metrics.operatingCashFlow.basis, 'current-period');
});

test('missing required amount is unresolved while missing currency remains resolved with warning', () => {
  const lines = canonicalFinancialLines().map(line => {
    if (line.accountId === 'ifrs-full_Revenue') {
      return { ...line, currentCumulativeAmount: null };
    }
    if (line.accountId === 'ifrs-full_CashAndCashEquivalents') {
      return { ...line, currency: null };
    }
    return line;
  });
  const summary = normalizer.normalize(financialStatementsDto({ lines }));
  assert.equal(summary.metrics.revenue.status === 'unresolved'
    && summary.metrics.revenue.reason, 'amount-missing');
  assert.equal(summary.metrics.cashAndCashEquivalents.status, 'resolved');
  assert.equal(summary.metrics.cashAndCashEquivalents.status === 'resolved'
    && summary.metrics.cashAndCashEquivalents.currency, null);
  assert.deepEqual(
    summary.warnings.find(warning => warning.code === 'MISSING_METRIC_CURRENCY')?.metrics,
    ['cashAndCashEquivalents'],
  );
});

test('summary preserves stale metadata and CFS to OFS report resolution without mutation', () => {
  const source = financialStatementsDto({
    requestedFsDiv: 'CFS',
    resolvedFsDiv: 'OFS',
    fallbackFromFsDiv: 'CFS',
    stale: true,
  });
  const summary = normalizer.normalize(source);
  assert.deepEqual(summary.report, source.report);
  assert.deepEqual(summary.metadata, source.metadata);
  assert.notEqual(summary.report, source.report);
  assert.notEqual(summary.metadata, source.metadata);
  assert.equal(summary.metadata.fallback, false);
});
