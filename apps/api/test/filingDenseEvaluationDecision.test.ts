import assert from 'node:assert/strict';
import test from 'node:test';

import { compareExactCostRatio, decideHnsw, estimateInputCostAtomicUnits, HNSW_CONFIG, summarizeLatency } from '../evaluation/filingDense/benchmark.js';
import { compareProfilePair, decideDenseWinner, PairedComparison, summarizePairs } from '../evaluation/filingDense/comparison.js';
import { canonicalSha256 } from '../evaluation/filingDense/canonical.js';
import { DENSE_EVAL_CRITICAL_CATEGORIES, DENSE_EVAL_LARGE_PROFILE_ID, DENSE_EVAL_SMALL_PROFILE_ID, DenseEvalDatasetEnvelope, DenseEvalEntry, DenseEvalRunRecord, DenseEvaluationError } from '../evaluation/filingDense/contracts.js';
import { annExactRecall, pairedBootstrapMeanCi, percentileR7 } from '../evaluation/filingDense/statistics.js';

const metrics = { hitAt5: 1 as const, hitAt10: 1 as const, recallAt5: 0.5, recallAt10: 1,
  reciprocalRankAt10: 0.5, ndcgAt10: 0.7, chunkRecallAt5: 0.5, chunkRecallAt10: 1,
  firstRelevantRank: 2, hitEvidenceGroupIds: ['g'], missingEvidenceGroupIds: [] };
const run = (profileId: string, overrides: Readonly<Record<string, unknown>> = {}): DenseEvalRunRecord => ({
  queryId: 'HOLD-001', split: 'holdout', categories: ['causal'], company: { corpCode: '00164779', symbol: '000660' },
  profileId, profileFingerprint: `${profileId}-fingerprint`, topK: 20, scopeFingerprint: 'scope',
  documents: [{ documentId: '1', representationFingerprint: 'representation' }], status: 'valid', metrics,
  ...overrides,
} as DenseEvalRunRecord);

test('paired comparison validates provenance and calculates large-minus-small deltas', () => {
  const pair = compareProfilePair(run(DENSE_EVAL_SMALL_PROFILE_ID), run(DENSE_EVAL_LARGE_PROFILE_ID,
    { metrics: { ...metrics, reciprocalRankAt10: 1, ndcgAt10: 0.9 } }));
  assert.equal(pair.status, 'valid');
  if (pair.status !== 'valid') return;
  assert.equal(pair.mrrDelta, 0.5);
  assert.ok(Math.abs(pair.ndcgDelta - 0.2) < 1e-12);
  assert.deepEqual({ queryId: pair.queryId, hitAt10Delta: pair.hitAt10Delta,
    recallAt10Delta: pair.recallAt10Delta, outcome: pair.outcome },
  { queryId: 'HOLD-001', hitAt10Delta: 0, recallAt10Delta: 0, outcome: 'win' });
});

test('paired comparison rejects mismatched scope, company, topK, documents, representation, invalid run, and same profile', async t => {
  const cases: readonly [string, Readonly<Record<string, unknown>>, string][] = [
    ['scope', { scopeFingerprint: 'other' }, 'SCOPE_MISMATCH'],
    ['company', { company: { corpCode: '00126380', symbol: '005930' } }, 'COMPANY_MISMATCH'],
    ['topK', { topK: 10 }, 'TOP_K_MISMATCH'],
    ['documents', { documents: [{ documentId: '2', representationFingerprint: 'representation' }] }, 'DOCUMENT_MISMATCH'],
    ['representation', { documents: [{ documentId: '1', representationFingerprint: 'other' }] }, 'REPRESENTATION_MISMATCH'],
    ['invalid', { status: 'timeout', metrics: undefined }, 'RUN_INVALID'],
  ];
  for (const [name, override, reason] of cases) await t.test(name, () => {
    assert.equal(compareProfilePair(run(DENSE_EVAL_SMALL_PROFILE_ID), run(DENSE_EVAL_LARGE_PROFILE_ID, override)).status, 'invalid');
    assert.equal((compareProfilePair(run(DENSE_EVAL_SMALL_PROFILE_ID),
      run(DENSE_EVAL_LARGE_PROFILE_ID, override)) as { reason: string }).reason, reason);
  });
  assert.throws(() => compareProfilePair(run(DENSE_EVAL_SMALL_PROFILE_ID),
    run(DENSE_EVAL_SMALL_PROFILE_ID)), DenseEvaluationError);
});

test('paired bootstrap is deterministic with fixed seed and rejects empty input', () => {
  const first = pairedBootstrapMeanCi([-0.1, 0, 0.1, 0.2]);
  assert.deepEqual(first, pairedBootstrapMeanCi([-0.1, 0, 0.1, 0.2]));
  assert.equal(first.iterations, 10_000);
  assert.equal(Number.isFinite(first.lower95), true);
  assert.throws(() => pairedBootstrapMeanCi([]), DenseEvaluationError);
  assert.equal(summarizePairs([]).status, 'inconclusive');
});

test('R-7 percentile has fixed interpolation and rejects invalid samples', () => {
  assert.equal(percentileR7([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(summarizeLatency([1, 2, 3, 4]).p95, 3.8499999999999996);
  assert.throws(() => percentileR7([], 0.5), DenseEvaluationError);
  assert.throws(() => percentileR7([Number.NaN], 0.5), DenseEvaluationError);
});

const pricing = (priceAtomicUnits: bigint) => ({
  snapshotId: 'manual-2026-09', currency: 'USD', effectiveAt: '2026-09-04T00:00:00Z',
  sourceLabel: 'execution-input', atomicUnitName: 'nano-dollar',
  atomicUnitsPerCurrencyUnit: 1_000_000_000n, priceAtomicUnits, tokensPerPriceUnit: 1_000_000n,
});

test('atomic-unit cost and exact ratio use integer arithmetic without display rounding', () => {
  assert.equal(estimateInputCostAtomicUnits(1_000_000n, pricing(2_500n)), 2_500n);
  assert.equal(estimateInputCostAtomicUnits(1n, pricing(2_500n)), 1n);
  assert.equal(compareExactCostRatio(
    { inputTokens: 1n, pricing: pricing(8_001n) },
    { inputTokens: 1n, pricing: pricing(1_000n) }, 8).withinLimit, false);
});

const chunk = (queryId: string) => ({
  provider: 'opendart-fss' as const, corpCode: '00164779', symbol: '000660',
  receiptNumber: `20260319${queryId.slice(-3).padStart(6, '0')}`, documentId: `document-${queryId}`,
  chunkId: `chunk-${queryId}`, contentHash: canonicalSha256({ queryId }),
  representationFingerprint: 'b'.repeat(64), parserVersion: 'parser@1', chunkerVersion: 'chunker@1',
  schemaVersion: 'canonical-filing@1', sectionPath: ['section'], locator: { ordinal: 1 },
});

function holdoutDataset(split: 'dev' | 'holdout' = 'holdout'): DenseEvalDatasetEnvelope {
  const entries: DenseEvalEntry[] = Array.from({ length: split === 'holdout' ? 20 : 40 }, (_, index) => {
    const queryId = `${split === 'holdout' ? 'HOLD' : 'DEV'}-${String(index + 1).padStart(3, '0')}`;
    return { queryId, split, queryText: `공개 검토 질문 ${index + 1}`,
      categories: [DENSE_EVAL_CRITICAL_CATEGORIES[index % DENSE_EVAL_CRITICAL_CATEGORIES.length]!],
      company: { corpCode: '00164779', symbol: '000660' }, reportFamily: 'annual',
      evidenceModality: 'narrative', currentEffectiveCorrection: index < 8,
      evidenceGroups: [{ evidenceGroupId: `group-${queryId}`, grade: 2, acceptableChunks: [chunk(queryId)] }],
      review: split === 'holdout' ? { status: 'sealed', reviewRoundCount: 2 }
        : { status: 'reviewed', reviewRoundCount: 1 } };
  });
  const payload = { datasetId: 'dense-eval-v1' as const, schemaVersion: 'dense-eval-dataset@1' as const,
    split, targetCount: split === 'holdout' ? 20 : 40, entries };
  return { payload, canonicalHash: canonicalSha256(payload) };
}

function winnerPairs(options: { readonly mrrDelta?: number; readonly invalidIndex?: number;
  readonly criticalRegression?: typeof DENSE_EVAL_CRITICAL_CATEGORIES[number] } = {}): PairedComparison[] {
  const dataset = holdoutDataset();
  return dataset.payload.entries.map((entry, index) => {
    const category = entry.categories[0]!;
    const mrrDelta = category === options.criticalRegression ? -0.06 : (options.mrrDelta ?? 0.04);
    const smallMetrics = { ...metrics, reciprocalRankAt10: 0.5, ndcgAt10: 0.7 };
    const largeMetrics = { ...metrics, reciprocalRankAt10: 0.5 + mrrDelta,
      ndcgAt10: 0.7 + (options.mrrDelta === 0.02 ? 0.01 : 0.03) };
    const measuredMrrDelta = largeMetrics.reciprocalRankAt10 - smallMetrics.reciprocalRankAt10;
    if (index === options.invalidIndex) return { status: 'invalid', queryId: entry.queryId, reason: 'RUN_INVALID' };
    return { status: 'valid', queryId: entry.queryId, split: 'holdout',
      smallProfileId: DENSE_EVAL_SMALL_PROFILE_ID, smallProfileFingerprint: 'small-fingerprint',
      largeProfileId: DENSE_EVAL_LARGE_PROFILE_ID, largeProfileFingerprint: 'large-fingerprint',
      categories: entry.categories,
      smallMetrics, largeMetrics, mrrDelta: measuredMrrDelta,
      ndcgDelta: largeMetrics.ndcgAt10 - smallMetrics.ndcgAt10,
      hitAt10Delta: 0, recallAt10Delta: 0, outcome: measuredMrrDelta > 0 ? 'win' : 'loss' };
  });
}

const passingCost = () => compareExactCostRatio(
  { inputTokens: 1n, pricing: pricing(7_000n) },
  { inputTokens: 1n, pricing: pricing(1_000n) }, 8);
const winnerInput = () => ({ holdoutDataset: holdoutDataset(), pairs: winnerPairs(),
  providerP95Ratio: 1.9, totalP95Ratio: 1.4, queryCostRatio: passingCost(),
  documentCostRatio: passingCost(), absoluteCost: { currency: 'USD',
    atomicUnitName: 'nano-dollar', atomicUnitsPerCurrencyUnit: '1000000000',
    estimatedAtomicUnits: 900n, approvedCapAtomicUnits: 1_000n } });

test('winner requires complete sealed paired holdout and enforces every decision gate', () => {
  assert.equal(decideDenseWinner(winnerInput()), 'LARGE_CANDIDATE_WINNER');
  assert.equal(decideDenseWinner({ ...winnerInput(), pairs: winnerPairs({ mrrDelta: 0.02 }) }), 'SMALL_OR_HOLD');
  assert.equal(decideDenseWinner({ ...winnerInput(), pairs: winnerPairs({ criticalRegression: 'causal' }) }), 'SMALL_OR_HOLD');
  assert.equal(decideDenseWinner({ ...winnerInput(), providerP95Ratio: 2.1 }), 'SMALL_OR_HOLD');
  const failedCost = compareExactCostRatio({ inputTokens: 1n, pricing: pricing(8_001n) },
    { inputTokens: 1n, pricing: pricing(1_000n) }, 8);
  assert.equal(decideDenseWinner({ ...winnerInput(), queryCostRatio: failedCost }), 'SMALL_OR_HOLD');
  assert.equal(decideDenseWinner({ ...winnerInput(), absoluteCost: { ...winnerInput().absoluteCost,
    atomicUnitName: 'micro-dollar' } }), 'SMALL_OR_HOLD');
  assert.equal(decideDenseWinner({ ...winnerInput(), pairs: winnerPairs({ invalidIndex: 19 }) }), 'INCONCLUSIVE');
  assert.equal(decideDenseWinner({ ...winnerInput(), pairs: winnerPairs().slice(0, 19) }), 'INCONCLUSIVE');
  const pairWithFailure = (failedSide: 'small' | 'large') => {
    const pairs = winnerPairs();
    const current = holdoutDataset().payload.entries[19]!;
    const small = run(DENSE_EVAL_SMALL_PROFILE_ID, { queryId: current.queryId, categories: current.categories,
      ...(failedSide === 'small' ? { status: 'provider_failure', metrics: undefined } : {}) });
    const large = run(DENSE_EVAL_LARGE_PROFILE_ID, { queryId: current.queryId, categories: current.categories,
      ...(failedSide === 'large' ? { status: 'provider_failure', metrics: undefined } : {}) });
    pairs[19] = compareProfilePair(small, large);
    return pairs;
  };
  assert.equal(decideDenseWinner({ ...winnerInput(), pairs: pairWithFailure('large') }), 'INCONCLUSIVE');
  assert.equal(decideDenseWinner({ ...winnerInput(), pairs: pairWithFailure('small') }), 'INCONCLUSIVE');
  const duplicate = winnerPairs();
  duplicate[19] = duplicate[18]!;
  assert.equal(decideDenseWinner({ ...winnerInput(), pairs: duplicate }), 'INCONCLUSIVE');
  assert.equal(decideDenseWinner({ ...winnerInput(), holdoutDataset: holdoutDataset('dev') }), 'INCONCLUSIVE');
});

const resources = { buildDurationMs: 10, indexBytes: 100n, vectorRelationBytes: 100n,
  peakPracticalMemoryBytes: 100n, blockingObserved: false, writeFailureCount: 0 };
test('HNSW decision distinguishes no-go, go, failed recall, and missing evidence', () => {
  assert.equal(decideHnsw({ exact40kRuns: Array.from({ length: 3 }, () => ({ p95Ms: 90, p99Ms: 190 })) }), 'NO_GO');
  const slow = [{ p95Ms: 120, p99Ms: 210 }, { p95Ms: 110, p99Ms: 190 }, { p95Ms: 90, p99Ms: 190 }];
  const complete = { exact40kRuns: slow, exactP95Ms: 120, hnswP95Ms: 60,
    annExactRecallAt10: 0.99, annExactRecallAt20: 0.96, resources };
  assert.equal(decideHnsw(complete), 'GO');
  assert.equal(decideHnsw({ ...complete, annExactRecallAt10: 0.97 }), 'NO_GO');
  assert.equal(decideHnsw({ ...complete, resources: { ...resources, blockingObserved: true } }), 'NO_GO');
  assert.equal(decideHnsw({}), 'INCONCLUSIVE');
  assert.equal(HNSW_CONFIG.parameterMatrix.length, 3);
});

test('ANN exact recall is set-based and order-independent', () => {
  assert.equal(annExactRecall(['a', 'b'], ['b', 'a']), 1);
  assert.equal(annExactRecall(['a', 'b'], ['a', 'c']), 0.5);
  assert.equal(annExactRecall(['a'], ['a'], 10), 1);
});
