import assert from 'node:assert/strict';
import test from 'node:test';

import { DenseEvalEntry, DenseEvalRunRecord, DenseEvaluationError, RankedEvidenceCandidate } from '../evaluation/filingDense/contracts.js';
import { aggregateCategoryMetrics, aggregateMetrics, evaluateRankedCandidates } from '../evaluation/filingDense/metrics.js';

const pin = (id: string) => ({
  provider: 'opendart-fss' as const, corpCode: '00164779', symbol: '000660', receiptNumber: '20260319000001',
  documentId: 'document-1', chunkId: id, contentHash: id.padEnd(64, 'a').slice(0, 64),
  representationFingerprint: 'b'.repeat(64), parserVersion: 'parser@1', chunkerVersion: 'chunker@1',
  schemaVersion: 'canonical-filing@1', sectionPath: ['section'], locator: { ordinal: 1 },
});
const entry: DenseEvalEntry = {
  queryId: 'DEV-001', split: 'dev', queryText: '질문', categories: ['causal', 'profit'],
  company: { corpCode: '00164779', symbol: '000660' }, reportFamily: 'annual', evidenceModality: 'narrative',
  currentEffectiveCorrection: false, review: { status: 'reviewed', reviewRoundCount: 1,
    reviewedAt: '2026-09-01T00:00:00Z', reviewerRoleId: 'evidence-review' },
  evidenceGroups: [
    { evidenceGroupId: 'cause', grade: 2, acceptableChunks: [pin('cause-a'), pin('cause-b')] },
    { evidenceGroupId: 'support', grade: 1, acceptableChunks: [pin('support')] },
  ],
};
const ranked = (...ids: string[]): RankedEvidenceCandidate[] => ids.map((id, index) => ({ rank: index + 1, chunk: pin(id), modality: 'dense' }));

test('group metrics treat neighboring acceptable chunks as one fact', () => {
  const result = evaluateRankedCandidates(entry, ranked('irrelevant', 'cause-a', 'cause-b', 'support'));
  assert.deepEqual({ hit5: result.hitAt5, hit10: result.hitAt10, recall5: result.recallAt5,
    recall10: result.recallAt10, mrr: result.reciprocalRankAt10 },
  { hit5: 1, hit10: 1, recall5: 1, recall10: 1, mrr: 0.5 });
  const expectedDcg = 3 / Math.log2(3) + 1 / Math.log2(5);
  const idealDcg = 3 + 1 / Math.log2(3);
  assert.ok(Math.abs(result.ndcgAt10 - expectedDcg / idealDcg) < 1e-12);
  assert.equal(result.chunkRecallAt5, 1);
  assert.deepEqual(result.hitEvidenceGroupIds, ['cause', 'support']);
});

test('metric engine returns zero for no hits and graded ideal score for exact ordering', () => {
  const none = evaluateRankedCandidates(entry, ranked('none'));
  assert.deepEqual([none.hitAt5, none.hitAt10, none.recallAt5, none.recallAt10,
    none.reciprocalRankAt10, none.ndcgAt10], [0, 0, 0, 0, 0, 0]);
  const ideal = evaluateRankedCandidates(entry, ranked('cause-a', 'support'));
  assert.equal(ideal.ndcgAt10, 1);
});

test('repeated acceptable chunks from one group never add recall, MRR, or nDCG gain', () => {
  const once = evaluateRankedCandidates(entry, ranked('cause-a'));
  const twice = evaluateRankedCandidates(entry, ranked('cause-a', 'cause-b'));
  assert.equal(twice.recallAt10, once.recallAt10);
  assert.equal(twice.reciprocalRankAt10, once.reciprocalRankAt10);
  assert.equal(twice.ndcgAt10, once.ndcgAt10);
});

test('metric engine rejects pending labels, bad ranks, duplicate candidates, and topK below ten', () => {
  assert.throws(() => evaluateRankedCandidates({ ...entry, review: { status: 'pending', reviewRoundCount: 0 } }, []),
    (value: unknown) => value instanceof DenseEvaluationError && value.code === 'PENDING_ANNOTATION');
  assert.throws(() => evaluateRankedCandidates(entry, [{ rank: 2, chunk: pin('x') }]), DenseEvaluationError);
  assert.throws(() => evaluateRankedCandidates(entry, ranked('x', 'x')), DenseEvaluationError);
  assert.throws(() => evaluateRankedCandidates(entry, [], 5), DenseEvaluationError);
});

function run(queryId: string, status: DenseEvalRunRecord['status'], categories = entry.categories,
  metrics = evaluateRankedCandidates(entry, ranked('cause-a'))): DenseEvalRunRecord {
  return { queryId, split: 'dev', categories, company: entry.company, profileId: 'small', profileFingerprint: 'a',
    topK: 20, scopeFingerprint: 'scope', documents: [], status,
    ...(status === 'valid' ? { metrics } : { failureCode: 'SAFE_FAILURE' }) };
}

test('aggregate denominator excludes invalid infrastructure runs', () => {
  const result = aggregateMetrics([run('DEV-001', 'valid'), run('DEV-002', 'provider_failure')]);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.validCount, 1);
  assert.equal(result.invalidCount, 1);
  assert.equal(result.meanHitAt10, 1);
});

test('category aggregation supports multi-label records and reports invalid counts', () => {
  const result = aggregateCategoryMetrics([run('DEV-001', 'valid'), run('DEV-002', 'timeout', ['causal'])]);
  const causal = result.find(value => value.category === 'causal')!;
  const profit = result.find(value => value.category === 'profit')!;
  assert.deepEqual([causal.sampleCount, causal.validCount, causal.invalidCount], [2, 1, 1]);
  assert.deepEqual([profit.sampleCount, profit.validCount, profit.invalidCount], [1, 1, 0]);
});

test('generic ranked candidate modality accepts lexical inputs', () => {
  const result = evaluateRankedCandidates(entry, [{ rank: 1, chunk: pin('support'), modality: 'lexical' }]);
  assert.equal(result.hitAt10, 1);
});
