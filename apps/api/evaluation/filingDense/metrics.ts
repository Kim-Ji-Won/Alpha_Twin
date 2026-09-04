import {
  DENSE_EVAL_CATEGORIES,
  DenseEvalCategory,
  DenseEvalEntry,
  DenseEvalMetrics,
  DenseEvalRunRecord,
  DenseEvaluationError,
  RankedEvidenceCandidate,
} from './contracts.js';
import { assertBenchmarkEligible, chunkKey } from './dataset.js';

function relevantGroupAtRank(
  entry: DenseEvalEntry,
  candidate: RankedEvidenceCandidate,
): { readonly id: string; readonly grade: 1 | 2 } | undefined {
  const key = chunkKey(candidate.chunk);
  const group = entry.evidenceGroups.find(value =>
    value.acceptableChunks.some(chunk => chunkKey(chunk) === key));
  return group ? { id: group.evidenceGroupId, grade: group.grade } : undefined;
}

function dcg(grades: readonly number[]): number {
  return grades.reduce((sum, grade, index) => sum + ((2 ** grade) - 1) / Math.log2(index + 2), 0);
}

export function evaluateRankedCandidates(
  entry: DenseEvalEntry,
  candidates: readonly RankedEvidenceCandidate[],
  topK = 20,
): DenseEvalMetrics {
  assertBenchmarkEligible(entry);
  if (!Number.isInteger(topK) || topK < 10 || topK > 20 || candidates.length > topK) {
    throw new DenseEvaluationError('METRIC_TOP_K_INVALID');
  }
  const seenCandidates = new Set<string>();
  for (const [index, candidate] of candidates.entries()) {
    if (candidate.rank !== index + 1) throw new DenseEvaluationError('METRIC_RANK_INVALID');
    const key = chunkKey(candidate.chunk);
    if (seenCandidates.has(key)) throw new DenseEvaluationError('METRIC_CANDIDATE_DUPLICATE');
    seenCandidates.add(key);
  }
  const groupByRank = candidates.map(candidate => relevantGroupAtRank(entry, candidate));
  const uniqueGroupHits = (limit: number): Set<string> => {
    const result = new Set<string>();
    for (const group of groupByRank.slice(0, limit)) if (group) result.add(group.id);
    return result;
  };
  const hits5 = uniqueGroupHits(5);
  const hits10 = uniqueGroupHits(10);
  const totalGroups = entry.evidenceGroups.length;
  const firstRelevant = groupByRank.findIndex(Boolean);
  const used = new Set<string>();
  const retrievedGrades = groupByRank.slice(0, 10).map(group => {
    if (!group || used.has(group.id)) return 0;
    used.add(group.id);
    return group.grade;
  });
  while (retrievedGrades.length < 10) retrievedGrades.push(0);
  const idealGrades = entry.evidenceGroups.map(group => group.grade).sort((left, right) => right - left).slice(0, 10);
  const ideal = dcg(idealGrades);
  const acceptable = new Set(entry.evidenceGroups.flatMap(group => group.acceptableChunks.map(chunkKey)));
  const chunkRecall = (limit: number): number => {
    if (acceptable.size === 0) return 0;
    const hits = new Set(candidates.slice(0, limit).map(candidate => chunkKey(candidate.chunk))
      .filter(key => acceptable.has(key)));
    return hits.size / acceptable.size;
  };
  return {
    hitAt5: hits5.size > 0 ? 1 : 0,
    hitAt10: hits10.size > 0 ? 1 : 0,
    recallAt5: totalGroups === 0 ? 0 : hits5.size / totalGroups,
    recallAt10: totalGroups === 0 ? 0 : hits10.size / totalGroups,
    reciprocalRankAt10: firstRelevant >= 0 && firstRelevant < 10 ? 1 / (firstRelevant + 1) : 0,
    ndcgAt10: ideal === 0 ? 0 : dcg(retrievedGrades) / ideal,
    chunkRecallAt5: chunkRecall(5),
    chunkRecallAt10: chunkRecall(10),
    firstRelevantRank: firstRelevant >= 0 ? firstRelevant + 1 : null,
    hitEvidenceGroupIds: [...hits10],
    missingEvidenceGroupIds: entry.evidenceGroups.map(group => group.evidenceGroupId)
      .filter(id => !hits10.has(id)),
  };
}

export interface AggregateMetrics {
  readonly sampleCount: number;
  readonly validCount: number;
  readonly invalidCount: number;
  readonly meanHitAt5: number;
  readonly meanHitAt10: number;
  readonly meanRecallAt5: number;
  readonly meanRecallAt10: number;
  readonly meanReciprocalRankAt10: number;
  readonly meanNdcgAt10: number;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function aggregateMetrics(records: readonly DenseEvalRunRecord[]): AggregateMetrics {
  const valid = records.filter((record): record is DenseEvalRunRecord & { readonly metrics: DenseEvalMetrics } =>
    record.status === 'valid' && record.metrics !== undefined);
  return {
    sampleCount: records.length,
    validCount: valid.length,
    invalidCount: records.length - valid.length,
    meanHitAt5: mean(valid.map(record => record.metrics.hitAt5)),
    meanHitAt10: mean(valid.map(record => record.metrics.hitAt10)),
    meanRecallAt5: mean(valid.map(record => record.metrics.recallAt5)),
    meanRecallAt10: mean(valid.map(record => record.metrics.recallAt10)),
    meanReciprocalRankAt10: mean(valid.map(record => record.metrics.reciprocalRankAt10)),
    meanNdcgAt10: mean(valid.map(record => record.metrics.ndcgAt10)),
  };
}

export interface CategoryAggregate {
  readonly category: DenseEvalCategory;
  readonly sampleCount: number;
  readonly validCount: number;
  readonly invalidCount: number;
  readonly hitAt10SuccessCount: number;
  readonly meanHitAt10: number;
  readonly meanReciprocalRankAt10: number;
}

export function aggregateCategoryMetrics(records: readonly DenseEvalRunRecord[]): readonly CategoryAggregate[] {
  return DENSE_EVAL_CATEGORIES.map(category => {
    const selected = records.filter(record => record.categories.includes(category));
    const valid = selected.filter((record): record is DenseEvalRunRecord & { readonly metrics: DenseEvalMetrics } =>
      record.status === 'valid' && record.metrics !== undefined);
    const successes = valid.reduce((sum, record) => sum + record.metrics.hitAt10, 0);
    return {
      category,
      sampleCount: selected.length,
      validCount: valid.length,
      invalidCount: selected.length - valid.length,
      hitAt10SuccessCount: successes,
      meanHitAt10: valid.length === 0 ? 0 : successes / valid.length,
      meanReciprocalRankAt10: mean(valid.map(record => record.metrics.reciprocalRankAt10)),
    };
  });
}
