import assert from 'node:assert/strict';
import test from 'node:test';

import { CompanyAnalysisContextBuilder } from '../src/ai/contextBuilder.js';
import { AiError } from '../src/ai/errors.js';
import { MarketDataError } from '../src/marketDataErrors.js';
import {
  AI_SYMBOL,
  companyProfile,
  contextSources,
  disclosures,
  latestFinancial,
  marketQuote,
} from './fixtures/ai.js';

function builder(options: Parameters<typeof contextSources>[0] = {}) {
  const sources = contextSources(options);
  return new CompanyAnalysisContextBuilder(
    sources.market,
    sources.company,
    sources.financial,
    () => new Date('2026-07-26T00:00:00.000Z'),
  );
}

test('context builder compacts all trusted sources and creates deterministic references', async () => {
  const result = await builder().build(AI_SYMBOL, 'request-1');
  assert.deepEqual(result.context.availability, {
    availableSources: ['market', 'profile', 'financial', 'disclosures'],
    missingSources: [],
    staleSources: [],
  });
  assert.equal(result.context.market?.dataMode, 'eod');
  assert.equal(result.context.financial?.metrics.length, 8);
  assert.equal(typeof result.context.financial?.metrics[0]?.value, 'string');
  assert.deepEqual([...result.validReferenceIds], [
    'profile:company',
    'market:quote',
    'financial:totalAssets',
    'financial:totalLiabilities',
    'financial:totalEquity',
    'financial:cashAndCashEquivalents',
    'financial:revenue',
    'financial:operatingIncome',
    'financial:netIncome',
    'financial:operatingCashFlow',
    'disclosure:20260725000001',
  ]);
  assert.equal(result.context.dataAsOf.financialPeriod, '2026-Q1');
  assert.equal(result.context.dataAsOf.latestDisclosureDate, '2026-07-25');
});

test('market Mock fallback is unavailable and never registers market evidence', async () => {
  const result = await builder({ market: marketQuote({ fallback: true, source: 'alpha-twin-mock' }) })
    .build(AI_SYMBOL);
  assert.equal(result.context.market, null);
  assert.deepEqual(result.context.availability.missingSources, ['market']);
  assert.equal(result.validReferenceIds.has('market:quote'), false);
});

test('stale trusted market and financial values remain available with stale metadata', async () => {
  const result = await builder({
    market: marketQuote({ stale: true }),
    financial: latestFinancial({ stale: true }),
  }).build(AI_SYMBOL);
  assert.deepEqual(result.context.availability.staleSources, ['market', 'financial']);
  assert.equal(result.context.market?.stale, true);
  assert.equal(result.context.financial?.stale, true);
});

test('profile or real market can independently confirm identity', async () => {
  const withMarket = await builder({ profile: new Error('profile unavailable') }).build(AI_SYMBOL);
  assert.equal(withMarket.context.identity.displayName, '합성전자');
  assert.deepEqual(withMarket.context.availability.missingSources, ['profile']);

  const withProfile = await builder({ market: new Error('market unavailable') }).build(AI_SYMBOL);
  assert.equal(withProfile.context.identity.displayName, '합성전자');
  assert.deepEqual(withProfile.context.availability.missingSources, ['market']);
});

test('missing all identity sources returns AI_CONTEXT_NOT_FOUND', async () => {
  await assert.rejects(
    builder({
      market: new Error('market unavailable'),
      profile: new Error('profile unavailable'),
    }).build(AI_SYMBOL),
    (error: unknown) => error instanceof AiError && error.code === 'AI_CONTEXT_NOT_FOUND',
  );
});

test('symbol mismatch in every returned source is a hard consistency failure', async () => {
  for (const options of [
    { market: marketQuote({ symbol: '005930' }) },
    { profile: companyProfile({ symbol: '005930' }) },
    { financial: latestFinancial({ symbol: '005930' }) },
    { disclosures: disclosures({ symbol: '005930' }) },
  ]) {
    await assert.rejects(
      builder(options).build(AI_SYMBOL),
      (error: unknown) => error instanceof AiError && error.code === 'AI_CONTEXT_INCONSISTENT',
    );
  }
});

test('semantic provider corruption is not silently downgraded to missing', async () => {
  await assert.rejects(
    builder({ market: new MarketDataError('INVALID_RESPONSE', 'private detail') }).build(AI_SYMBOL),
    (error: unknown) => error instanceof AiError && error.code === 'AI_CONTEXT_BUILD_FAILED',
  );
});

test('ordinary source failure permits partial context', async () => {
  const result = await builder({
    financial: new Error('temporary upstream failure'),
    disclosures: new Error('temporary upstream failure'),
  }).build(AI_SYMBOL);
  assert.deepEqual(result.context.availability.missingSources, ['financial', 'disclosures']);
  assert.equal(result.context.financial, null);
  assert.deepEqual(result.context.disclosures, []);
});

test('successful empty disclosures remain available rather than missing', async () => {
  const result = await builder({ disclosures: disclosures({ empty: true }) }).build(AI_SYMBOL);
  assert.equal(result.context.availability.availableSources.includes('disclosures'), true);
  assert.deepEqual(result.context.disclosures, []);
  assert.equal(result.context.dataAsOf.latestDisclosureDate, null);
});

test('withdrawn disclosures stay visible as status data but cannot become evidence', async () => {
  const result = await builder({ disclosures: disclosures({ withdrawn: true }) }).build(AI_SYMBOL);
  assert.equal(result.context.disclosures[0]?.isWithdrawn, true);
  assert.equal(result.validReferenceIds.has('disclosure:20260725000001'), false);
});

test('unresolved and conflicted financial metrics retain status without factual references', async () => {
  const financial = latestFinancial();
  financial.summary.metrics.revenue = {
    metric: 'revenue',
    status: 'unresolved',
    value: null,
    reason: 'account-not-found',
  };
  financial.summary.metrics.operatingIncome = {
    metric: 'operatingIncome',
    status: 'conflict',
    value: null,
    reason: 'value-conflict',
    candidates: [],
  };
  const result = await builder({ financial }).build(AI_SYMBOL);
  assert.equal(result.validReferenceIds.has('financial:revenue'), false);
  assert.equal(result.validReferenceIds.has('financial:operatingIncome'), false);
  assert.equal(result.context.financial?.metrics[4]?.status, 'unresolved');
  assert.equal(result.context.financial?.metrics[5]?.status, 'conflict');
});

test('actual OFS resolution is preserved in compact financial context', async () => {
  const result = await builder({ financial: latestFinancial({ resolvedFsDiv: 'OFS' }) })
    .build(AI_SYMBOL);
  assert.equal(result.context.financial?.requestedFsDiv, 'CFS');
  assert.equal(result.context.financial?.resolvedFsDiv, 'OFS');
});

test('resolved metric evidence must belong to the selected latest financial receipt', async () => {
  const financial = latestFinancial();
  const revenue = financial.summary.metrics.revenue;
  if (revenue.status !== 'resolved') throw new Error('synthetic fixture must resolve revenue');
  financial.summary.metrics.revenue = {
    ...revenue,
    evidence: { ...revenue.evidence, receiptNumber: '20260726009999' },
  };
  await assert.rejects(
    builder({ financial }).build(AI_SYMBOL),
    (error: unknown) => error instanceof AiError && error.code === 'AI_CONTEXT_INCONSISTENT',
  );
});
