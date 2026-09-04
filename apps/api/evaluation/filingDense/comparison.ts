import {
  DENSE_EVAL_CRITICAL_CATEGORIES,
  DENSE_EVAL_DATASET_ID,
  DENSE_EVAL_DATASET_SCHEMA,
  DENSE_EVAL_LARGE_PROFILE_ID,
  DENSE_EVAL_SMALL_PROFILE_ID,
  DenseEvalDatasetEnvelope,
  DenseEvalMetrics,
  DenseEvalRunRecord,
  DenseEvaluationError,
} from './contracts.js';
import { ExactCostRatioResult } from './benchmark.js';
import { parseDatasetEnvelope } from './dataset.js';
import { pairedBootstrapMeanCi } from './statistics.js';

export type PairInvalidReason =
  | 'RUN_INVALID'
  | 'QUERY_MISMATCH'
  | 'SPLIT_MISMATCH'
  | 'CATEGORY_MISMATCH'
  | 'TOP_K_INVALID'
  | 'COMPANY_MISMATCH'
  | 'TOP_K_MISMATCH'
  | 'SCOPE_MISMATCH'
  | 'DOCUMENT_MISMATCH'
  | 'REPRESENTATION_MISMATCH';

export type PairedComparison = {
  readonly status: 'invalid'; readonly queryId: string; readonly reason: PairInvalidReason;
} | {
  readonly status: 'valid'; readonly queryId: string;
  readonly split: DenseEvalRunRecord['split'];
  readonly smallProfileId: string;
  readonly smallProfileFingerprint: string;
  readonly largeProfileId: string;
  readonly largeProfileFingerprint: string;
  readonly categories: DenseEvalRunRecord['categories'];
  readonly smallMetrics: DenseEvalMetrics;
  readonly largeMetrics: DenseEvalMetrics;
  readonly mrrDelta: number; readonly ndcgDelta: number; readonly hitAt10Delta: number;
  readonly recallAt10Delta: number; readonly outcome: 'win' | 'tie' | 'loss';
};

function sameDocuments(left: DenseEvalRunRecord, right: DenseEvalRunRecord): boolean {
  return left.documents.length === right.documents.length && left.documents.every((document, index) => {
    const other = right.documents[index];
    return other?.documentId === document.documentId;
  });
}

function sameRepresentations(left: DenseEvalRunRecord, right: DenseEvalRunRecord): boolean {
  return left.documents.length === right.documents.length && left.documents.every((document, index) =>
    right.documents[index]?.representationFingerprint === document.representationFingerprint);
}

function validMetrics(metrics: DenseEvalMetrics): boolean {
  const values = [metrics.hitAt5, metrics.hitAt10, metrics.recallAt5, metrics.recallAt10,
    metrics.reciprocalRankAt10, metrics.ndcgAt10, metrics.chunkRecallAt5, metrics.chunkRecallAt10];
  return values.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    && (metrics.firstRelevantRank === null
      || (Number.isInteger(metrics.firstRelevantRank) && metrics.firstRelevantRank >= 1));
}

export function compareProfilePair(small: DenseEvalRunRecord, large: DenseEvalRunRecord): PairedComparison {
  if (small.profileId === large.profileId) throw new DenseEvaluationError('PAIR_SAME_PROFILE');
  const invalid = (reason: PairInvalidReason): PairedComparison => ({ status: 'invalid', queryId: small.queryId, reason });
  if (small.status !== 'valid' || large.status !== 'valid' || !small.metrics || !large.metrics) return invalid('RUN_INVALID');
  if (!validMetrics(small.metrics) || !validMetrics(large.metrics)) return invalid('RUN_INVALID');
  if (small.queryId !== large.queryId) return invalid('QUERY_MISMATCH');
  if (small.split !== large.split) return invalid('SPLIT_MISMATCH');
  if (small.categories.length !== large.categories.length
    || small.categories.some(category => !large.categories.includes(category))) return invalid('CATEGORY_MISMATCH');
  if (small.company.corpCode !== large.company.corpCode || small.company.symbol !== large.company.symbol) return invalid('COMPANY_MISMATCH');
  if (!Number.isInteger(small.topK) || small.topK < 10 || small.topK > 20
    || !Number.isInteger(large.topK) || large.topK < 10 || large.topK > 20) return invalid('TOP_K_INVALID');
  if (small.topK !== large.topK) return invalid('TOP_K_MISMATCH');
  if (small.scopeFingerprint !== large.scopeFingerprint) return invalid('SCOPE_MISMATCH');
  if (!sameDocuments(small, large)) return invalid('DOCUMENT_MISMATCH');
  if (!sameRepresentations(small, large)) return invalid('REPRESENTATION_MISMATCH');
  const mrrDelta = large.metrics.reciprocalRankAt10 - small.metrics.reciprocalRankAt10;
  return {
    status: 'valid', queryId: small.queryId, split: small.split,
    smallProfileId: small.profileId, smallProfileFingerprint: small.profileFingerprint,
    largeProfileId: large.profileId, largeProfileFingerprint: large.profileFingerprint,
    categories: small.categories,
    smallMetrics: small.metrics, largeMetrics: large.metrics, mrrDelta,
    ndcgDelta: large.metrics.ndcgAt10 - small.metrics.ndcgAt10,
    hitAt10Delta: large.metrics.hitAt10 - small.metrics.hitAt10,
    recallAt10Delta: large.metrics.recallAt10 - small.metrics.recallAt10,
    outcome: mrrDelta > 0 ? 'win' : mrrDelta < 0 ? 'loss' : 'tie',
  };
}

export function summarizePairs(pairs: readonly PairedComparison[]) {
  const valid = pairs.filter((pair): pair is Extract<PairedComparison, { status: 'valid' }> => pair.status === 'valid');
  if (valid.length === 0) return { status: 'inconclusive' as const, validCount: 0, invalidCount: pairs.length };
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    status: 'valid' as const,
    validCount: valid.length,
    invalidCount: pairs.length - valid.length,
    meanMrrDelta: mean(valid.map(pair => pair.mrrDelta)),
    meanNdcgDelta: mean(valid.map(pair => pair.ndcgDelta)),
    bootstrapMrr: pairedBootstrapMeanCi(valid.map(pair => pair.mrrDelta)),
    wins: valid.filter(pair => pair.outcome === 'win').length,
    ties: valid.filter(pair => pair.outcome === 'tie').length,
    losses: valid.filter(pair => pair.outcome === 'loss').length,
  };
}

export const DENSE_WINNER_RULE = Object.freeze({
  version: 'dense-winner-rule@1',
  minimumHoldoutMrrDelta: 0.03,
  minimumHoldoutNdcgDelta: 0.02,
  minimumBootstrapLowerBound: 0,
  maximumCriticalMrrDecline: -0.05,
  maximumProviderP95Ratio: 2,
  maximumTotalP95Ratio: 1.5,
  maximumQueryCostRatio: 8,
  maximumDocumentCostRatio: 8,
});

export interface WinnerDecisionInput {
  readonly holdoutDataset: DenseEvalDatasetEnvelope;
  readonly pairs: readonly PairedComparison[];
  readonly providerP95Ratio: number;
  readonly totalP95Ratio: number;
  readonly queryCostRatio: ExactCostRatioResult;
  readonly documentCostRatio: ExactCostRatioResult;
  readonly absoluteCost: {
    readonly currency: string;
    readonly atomicUnitName: string;
    readonly atomicUnitsPerCurrencyUnit: string;
    readonly estimatedAtomicUnits: bigint;
    readonly approvedCapAtomicUnits: bigint;
  };
}

export type WinnerDecision = 'LARGE_CANDIDATE_WINNER' | 'SMALL_OR_HOLD' | 'INCONCLUSIVE';

export function decideDenseWinner(input: WinnerDecisionInput): WinnerDecision {
  let dataset: DenseEvalDatasetEnvelope;
  try {
    dataset = parseDatasetEnvelope(input.holdoutDataset, 'holdout');
  } catch (error) {
    if (error instanceof DenseEvaluationError) return 'INCONCLUSIVE';
    throw error;
  }
  if (dataset.payload.datasetId !== DENSE_EVAL_DATASET_ID
    || dataset.payload.schemaVersion !== DENSE_EVAL_DATASET_SCHEMA
    || dataset.payload.entries.length !== 20
    || dataset.payload.entries.some(entry => entry.review.status !== 'sealed')) return 'INCONCLUSIVE';
  const expectedIds = dataset.payload.entries.map(entry => entry.queryId);
  const pairIds = input.pairs.map(pair => pair.queryId);
  if (new Set(expectedIds).size !== 20 || new Set(pairIds).size !== 20
    || input.pairs.length !== 20 || input.pairs.some(pair => pair.status !== 'valid')
    || expectedIds.some(id => !pairIds.includes(id))) return 'INCONCLUSIVE';
  const validPairs = input.pairs as readonly Extract<PairedComparison, { status: 'valid' }>[];
  if (validPairs.some(pair => {
    const expected = dataset.payload.entries.find(entry => entry.queryId === pair.queryId);
    const expectedMrr = pair.largeMetrics.reciprocalRankAt10 - pair.smallMetrics.reciprocalRankAt10;
    const expectedNdcg = pair.largeMetrics.ndcgAt10 - pair.smallMetrics.ndcgAt10;
    const expectedHit = pair.largeMetrics.hitAt10 - pair.smallMetrics.hitAt10;
    const expectedRecall = pair.largeMetrics.recallAt10 - pair.smallMetrics.recallAt10;
    const expectedOutcome = expectedMrr > 0 ? 'win' : expectedMrr < 0 ? 'loss' : 'tie';
    return !expected || pair.split !== 'holdout'
      || pair.smallProfileId !== DENSE_EVAL_SMALL_PROFILE_ID
      || pair.largeProfileId !== DENSE_EVAL_LARGE_PROFILE_ID
      || !pair.smallProfileFingerprint || !pair.largeProfileFingerprint
      || pair.smallProfileFingerprint === pair.largeProfileFingerprint
      || !validMetrics(pair.smallMetrics) || !validMetrics(pair.largeMetrics)
      || pair.mrrDelta !== expectedMrr || pair.ndcgDelta !== expectedNdcg
      || pair.hitAt10Delta !== expectedHit || pair.recallAt10Delta !== expectedRecall
      || pair.outcome !== expectedOutcome
      || expected.categories.length !== pair.categories.length
      || expected.categories.some(category => !pair.categories.includes(category));
  })) return 'INCONCLUSIVE';
  if (new Set(validPairs.map(pair => pair.smallProfileFingerprint)).size !== 1
    || new Set(validPairs.map(pair => pair.largeProfileFingerprint)).size !== 1) return 'INCONCLUSIVE';
  const summary = summarizePairs(validPairs);
  if (summary.status !== 'valid' || summary.validCount !== 20 || summary.invalidCount !== 0) {
    return 'INCONCLUSIVE';
  }
  for (const category of DENSE_EVAL_CRITICAL_CATEGORIES) {
    const expectedCategoryIds = dataset.payload.entries.filter(entry => entry.categories.includes(category))
      .map(entry => entry.queryId);
    const categoryPairs = validPairs.filter(pair => expectedCategoryIds.includes(pair.queryId));
    if (expectedCategoryIds.length === 0 || categoryPairs.length !== expectedCategoryIds.length
      || categoryPairs.some(pair => !pair.categories.includes(category))) return 'INCONCLUSIVE';
    const smallMrr = categoryPairs.reduce((sum, pair) => sum + pair.smallMetrics.reciprocalRankAt10, 0)
      / categoryPairs.length;
    const largeMrr = categoryPairs.reduce((sum, pair) => sum + pair.largeMetrics.reciprocalRankAt10, 0)
      / categoryPairs.length;
    const smallHits = categoryPairs.reduce((sum, pair) => sum + pair.smallMetrics.hitAt10, 0);
    const largeHits = categoryPairs.reduce((sum, pair) => sum + pair.largeMetrics.hitAt10, 0);
    if (largeMrr - smallMrr < DENSE_WINNER_RULE.maximumCriticalMrrDecline
      || largeHits < smallHits) return 'SMALL_OR_HOLD';
  }
  const finite = [summary.meanMrrDelta, summary.meanNdcgDelta,
    summary.bootstrapMrr.lower95, input.providerP95Ratio, input.totalP95Ratio]
    .every(Number.isFinite);
  if (!finite || input.providerP95Ratio < 0 || input.totalP95Ratio < 0) return 'INCONCLUSIVE';
  if (summary.meanMrrDelta < DENSE_WINNER_RULE.minimumHoldoutMrrDelta
    || summary.meanNdcgDelta < DENSE_WINNER_RULE.minimumHoldoutNdcgDelta
    || summary.bootstrapMrr.lower95 <= DENSE_WINNER_RULE.minimumBootstrapLowerBound
    || input.providerP95Ratio > DENSE_WINNER_RULE.maximumProviderP95Ratio
    || input.totalP95Ratio > DENSE_WINNER_RULE.maximumTotalP95Ratio
    || !input.queryCostRatio.compatible || !input.queryCostRatio.withinLimit
    || input.queryCostRatio.limit !== DENSE_WINNER_RULE.maximumQueryCostRatio
    || !input.documentCostRatio.compatible || !input.documentCostRatio.withinLimit
    || input.documentCostRatio.limit !== DENSE_WINNER_RULE.maximumDocumentCostRatio
    || input.absoluteCost.estimatedAtomicUnits < 0n || input.absoluteCost.approvedCapAtomicUnits < 0n
    || input.queryCostRatio.currency !== input.absoluteCost.currency
    || input.documentCostRatio.currency !== input.absoluteCost.currency
    || input.queryCostRatio.atomicUnitName !== input.absoluteCost.atomicUnitName
    || input.documentCostRatio.atomicUnitName !== input.absoluteCost.atomicUnitName
    || input.queryCostRatio.atomicUnitsPerCurrencyUnit !== input.absoluteCost.atomicUnitsPerCurrencyUnit
    || input.documentCostRatio.atomicUnitsPerCurrencyUnit !== input.absoluteCost.atomicUnitsPerCurrencyUnit
    || input.absoluteCost.estimatedAtomicUnits > input.absoluteCost.approvedCapAtomicUnits) return 'SMALL_OR_HOLD';
  return 'LARGE_CANDIDATE_WINNER';
}
