import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalSha256 } from '../evaluation/filingDense/canonical.js';
import {
  assessDatasetReadiness,
  assertReviewTransition,
  evaluateDatasetCoverage,
  findCopiedTokenSequence,
  loadDevelopmentDataset,
  loadFinalDecisionDatasets,
  parseDatasetEnvelope,
  requiresLeakageRewrite,
  validateCurrentEffectiveEvidence,
} from '../evaluation/filingDense/dataset.js';
import { DenseEvalDatasetPayload, DenseEvalEntry, DenseEvaluationError } from '../evaluation/filingDense/contracts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../evaluation/fixtures/dense-eval-v1');
const hash = 'a'.repeat(64);
const reviewMetadata = { reviewedAt: '2026-09-01T00:00:00Z', reviewerRoleId: 'evidence-review' };
const chunk = (id = 'chunk-1') => ({
  provider: 'opendart-fss' as const, corpCode: '00164779', symbol: '000660',
  receiptNumber: '20260319000001', documentId: 'document-1', chunkId: id, contentHash: hash,
  representationFingerprint: 'b'.repeat(64), parserVersion: 'parser@1', chunkerVersion: 'chunker@1',
  schemaVersion: 'canonical-filing@1', sectionPath: ['사업의 내용'], locator: { ordinal: 1 },
});
const entry = (overrides: Readonly<Record<string, unknown>> = {}): DenseEvalEntry => ({
  queryId: 'DEV-001', split: 'dev', queryText: '영업이익 증가 원인은 무엇인가?',
  categories: ['causal', 'profit'], company: { corpCode: '00164779', symbol: '000660' },
  reportFamily: 'annual', evidenceModality: 'narrative', currentEffectiveCorrection: false,
  evidenceGroups: [{ evidenceGroupId: 'group-1', grade: 2, acceptableChunks: [chunk()] }],
  review: { status: 'reviewed', reviewRoundCount: 1, ...reviewMetadata },
  ...overrides,
} as DenseEvalEntry);
function envelope(current: DenseEvalEntry, split: 'dev' | 'holdout' = 'dev') {
  const payload: DenseEvalDatasetPayload = {
    datasetId: 'dense-eval-v1', schemaVersion: 'dense-eval-dataset@1', split,
    targetCount: split === 'dev' ? 40 : 20, entries: [current],
  };
  return { payload, canonicalHash: canonicalSha256(payload) };
}
const code = (expected: string) => (value: unknown) =>
  value instanceof DenseEvaluationError && value.code === expected;

test('valid reviewed dev and sealed holdout entries parse', () => {
  assert.equal(parseDatasetEnvelope(envelope(entry()), 'dev').payload.entries.length, 1);
  const holdout = entry({ queryId: 'HOLD-001', split: 'holdout', review: { status: 'sealed', reviewRoundCount: 2, ...reviewMetadata } });
  assert.equal(parseDatasetEnvelope(envelope(holdout, 'holdout'), 'holdout').payload.entries.length, 1);
});

test('dataset rejects duplicate IDs, categories, bad grade, and empty evidence', async t => {
  const cases: readonly [string, DenseEvalEntry, string][] = [
    ['unknown category', entry({ categories: ['unknown'] }), 'DATASET_CATEGORY_INVALID'],
    ['missing category', entry({ categories: [] }), 'DATASET_CATEGORIES_EMPTY'],
    ['invalid grade', entry({ evidenceGroups: [{ evidenceGroupId: 'g', grade: 0, acceptableChunks: [chunk()] }] }), 'DATASET_GRADE_INVALID'],
    ['empty evidence', entry({ evidenceGroups: [{ evidenceGroupId: 'g', grade: 2, acceptableChunks: [] }] }), 'DATASET_GROUP_EMPTY'],
    ['invalid review', entry({ review: { status: 'approved', reviewRoundCount: 1 } }), 'DATASET_REVIEW_STATE_INVALID'],
  ];
  for (const [name, value, expected] of cases) await t.test(name, () => {
    assert.throws(() => parseDatasetEnvelope(envelope(value), 'dev'), code(expected));
  });
  const duplicatePayload = envelope(entry()).payload;
  const value = { payload: { ...duplicatePayload, entries: [entry(), entry()] } };
  assert.throws(() => parseDatasetEnvelope({ ...value, canonicalHash: canonicalSha256(value.payload) }, 'dev'),
    code('DATASET_QUERY_ID_DUPLICATE'));
});

test('dataset rejects duplicate acceptable chunks across evidence groups', () => {
  const value = entry({ evidenceGroups: [
    { evidenceGroupId: 'g1', grade: 2, acceptableChunks: [chunk()] },
    { evidenceGroupId: 'g2', grade: 1, acceptableChunks: [chunk()] },
  ] });
  assert.throws(() => parseDatasetEnvelope(envelope(value), 'dev'), code('DATASET_CHUNK_DUPLICATE'));
});

test('dataset rejects wrong version, split count target, and hash', () => {
  const valid = envelope(entry());
  const wrongVersion = { ...valid, payload: { ...valid.payload, datasetId: 'dense-eval-v2' } };
  assert.throws(() => parseDatasetEnvelope(wrongVersion, 'dev'), code('DATASET_VERSION_INVALID'));
  const wrongTarget = { payload: { ...valid.payload, targetCount: 39 }, canonicalHash: '' };
  assert.throws(() => parseDatasetEnvelope(wrongTarget, 'dev'), code('DATASET_TARGET_INVALID'));
  assert.throws(() => parseDatasetEnvelope({ ...valid, canonicalHash: 'c'.repeat(64) }, 'dev'), code('DATASET_HASH_MISMATCH'));
  assert.throws(() => parseDatasetEnvelope(valid, 'holdout'), code('DATASET_SPLIT_MISMATCH'));
  const unknown = { ...valid, payload: { ...valid.payload, unexpected: true } };
  assert.throws(() => parseDatasetEnvelope(unknown, 'dev'), code('DATASET_UNKNOWN_FIELD'));
});

test('canonical dataset hash ignores key order but changes with review or evidence mutation', () => {
  const left = { alpha: 1, nested: { beta: 2, gamma: 3 } };
  const reordered = { nested: { gamma: 3, beta: 2 }, alpha: 1 };
  assert.equal(canonicalSha256(left), canonicalSha256(reordered));
  assert.notEqual(canonicalSha256(envelope(entry()).payload),
    canonicalSha256(envelope(entry({ review: { status: 'reviewed', reviewRoundCount: 2, ...reviewMetadata } })).payload));
  assert.notEqual(canonicalSha256(envelope(entry()).payload),
    canonicalSha256(envelope(entry({ evidenceGroups: [{ evidenceGroupId: 'changed', grade: 2,
      acceptableChunks: [chunk()] }] })).payload));
});

test('pending entries are valid annotations but benchmark dataset is not ready', () => {
  const pending = entry({ evidenceGroups: [], review: { status: 'pending', reviewRoundCount: 0 } });
  assert.equal(parseDatasetEnvelope(envelope(pending), 'dev').payload.entries[0]?.review.status, 'pending');
});

test('development loader reads only dev and final loader needs explicit holdout permission', async () => {
  const dev = await loadDevelopmentDataset(ROOT);
  assert.equal(dev.payload.split, 'dev');
  await assert.rejects(loadFinalDecisionDatasets(ROOT, { allowSealedHoldout: false }), code('HOLDOUT_ACCESS_DENIED'));
  const both = await loadFinalDecisionDatasets(ROOT, { allowSealedHoldout: true });
  assert.equal(both.holdout.payload.split, 'holdout');
});

test('empty canonical manifests disclose annotation incompleteness', async () => {
  const { dev, holdout } = await loadFinalDecisionDatasets(ROOT, { allowSealedHoldout: true });
  assert.deepEqual(assessDatasetReadiness(dev, holdout).ready, false);
  const coverage = evaluateDatasetCoverage([]);
  assert.equal(coverage.total, 0);
  assert.ok(coverage.errors.includes('COMPANY_MINIMUM_NOT_MET'));
});

test('current-effective evidence seam detects missing pinned chunks', () => {
  const value = entry();
  const absent = validateCurrentEffectiveEvidence(value, new Set());
  assert.equal(absent.compatible, false);
  const key = absent.missingChunkKeys[0]!;
  assert.deepEqual(validateCurrentEffectiveEvidence(value, new Set([key])), { compatible: true, missingChunkKeys: [] });
});

test('review-time leakage helper detects an eight-token sequence without persisting source', () => {
  assert.equal(findCopiedTokenSequence('하나 둘 셋 넷 다섯 여섯 일곱 여덟', '앞 하나 둘 셋 넷 다섯 여섯 일곱 여덟 뒤'), true);
  assert.equal(findCopiedTokenSequence('하나 둘 셋 넷 다섯 여섯 일곱', '하나 둘 셋 넷 다섯 여섯 일곱'), false);
  const copied = entry({ queryText: '하나 둘 셋 넷 다섯 여섯 일곱 여덟' });
  assert.equal(requiresLeakageRewrite(copied, '하나 둘 셋 넷 다섯 여섯 일곱 여덟'), true);
  assert.equal(requiresLeakageRewrite({ ...copied, categories: ['numeric'] },
    '하나 둘 셋 넷 다섯 여섯 일곱 여덟'), false);
  assert.equal(requiresLeakageRewrite(copied, '하나 둘 셋 넷 다섯 여섯 일곱 여덟',
    { literalLookupQuestion: true }), false);
});

test('review transitions separate dev review from terminal sealed holdout', () => {
  assert.doesNotThrow(() => assertReviewTransition('dev',
    { status: 'pending', reviewRoundCount: 0 }, { status: 'reviewed', reviewRoundCount: 1, ...reviewMetadata }));
  assert.doesNotThrow(() => assertReviewTransition('holdout',
    { status: 'pending', reviewRoundCount: 0 }, { status: 'sealed', reviewRoundCount: 2, ...reviewMetadata }));
  assert.throws(() => assertReviewTransition('dev',
    { status: 'reviewed', reviewRoundCount: 1, ...reviewMetadata }, { status: 'sealed', reviewRoundCount: 2, ...reviewMetadata }),
  code('REVIEW_TRANSITION_INVALID'));
  assert.throws(() => assertReviewTransition('holdout',
    { status: 'sealed', reviewRoundCount: 2, ...reviewMetadata }, { status: 'pending', reviewRoundCount: 2 }),
  code('SEALED_REVIEW_IMMUTABLE'));
});

test('review metadata is mandatory for reviewed/sealed and absent for pending', () => {
  for (const status of ['pending', 'reviewed', 'sealed'] as const) {
    const split = status === 'sealed' ? 'holdout' : 'dev';
    const base = { status, reviewRoundCount: status === 'pending' ? 0 : status === 'reviewed' ? 1 : 2 };
    const parse = (review: Record<string, unknown>) => parseDatasetEnvelope(envelope(entry({
      queryId: split === 'dev' ? 'DEV-001' : 'HOLD-001', split, review,
    }), split), split);
    assert.doesNotThrow(() => parse(status === 'pending' ? base : { ...base, ...reviewMetadata }));
    for (const key of ['reviewedAt', 'reviewerRoleId'] as const) {
      if (status === 'pending') {
        for (const value of [reviewMetadata[key], undefined, null]) {
          assert.throws(() => parse({ ...base, [key]: value }), code('DATASET_REVIEW_EVIDENCE_INVALID'));
        }
      } else {
        const incomplete: Record<string, unknown> = { ...base, ...reviewMetadata };
        delete incomplete[key];
        assert.throws(() => parse(incomplete), code('DATASET_REVIEW_EVIDENCE_INVALID'));
        for (const value of ['', null, undefined, 'not valid']) {
          assert.throws(() => parse({ ...base, ...reviewMetadata, [key]: value }), code('DATASET_REVIEW_EVIDENCE_INVALID'));
        }
      }
    }
    if (status !== 'pending') assert.throws(() => parse(base), code('DATASET_REVIEW_EVIDENCE_INVALID'));
  }
  assert.throws(() => parseDatasetEnvelope(envelope(entry({ review: {
    status: 'sealed', reviewRoundCount: 2, ...reviewMetadata,
  } })), 'dev'), code('DATASET_DEV_SEALED_INVALID'));
  assert.throws(() => parseDatasetEnvelope(envelope(entry({ queryId: 'HOLD-001', split: 'holdout',
    review: { status: 'reviewed', reviewRoundCount: 1, ...reviewMetadata },
  }), 'holdout'), 'holdout'), code('DATASET_HOLDOUT_NOT_SEALED'));
  assert.throws(() => assertReviewTransition('dev', { status: 'pending', reviewRoundCount: 0 },
    { status: 'reviewed', reviewRoundCount: 1 }), code('DATASET_REVIEW_EVIDENCE_INVALID'));
});
