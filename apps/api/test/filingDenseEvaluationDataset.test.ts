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
import { evaluateRankedCandidates } from '../evaluation/filingDense/metrics.js';

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

test('partial canonical manifests disclose annotation incompleteness', async () => {
  const { dev, holdout } = await loadFinalDecisionDatasets(ROOT, { allowSealedHoldout: true });
  assert.deepEqual(assessDatasetReadiness(dev, holdout).ready, false);
  const coverage = evaluateDatasetCoverage([]);
  assert.equal(coverage.total, 0);
  assert.ok(coverage.errors.includes('COMPANY_MINIMUM_NOT_MET'));
});

test('first four dev tranches preserve author review and historical-source coverage', async () => {
  const { dev, holdout } = await loadFinalDecisionDatasets(ROOT, { allowSealedHoldout: true });
  const entries = dev.payload.entries;
  assert.deepEqual(entries.map(value => value.queryId), [
    'DEV-001', 'DEV-002', 'DEV-003', 'DEV-004', 'DEV-005',
    'DEV-006', 'DEV-007', 'DEV-008', 'DEV-009', 'DEV-010',
    'DEV-011', 'DEV-012', 'DEV-013', 'DEV-014', 'DEV-015',
    'DEV-016', 'DEV-017', 'DEV-018', 'DEV-019', 'DEV-020',
  ]);
  assert.equal(new Set(entries.map(value => value.queryId)).size, 20);
  assert.equal(dev.payload.datasetId, 'dense-eval-v1');
  assert.equal(dev.payload.targetCount, 40);
  assert.equal(dev.payload.schemaVersion, 'dense-eval-dataset@1');
  assert.equal(dev.canonicalHash, canonicalSha256(dev.payload));
  // Preserve previously approved payloads, including every pin and review.
  assert.equal(canonicalSha256({ ...dev.payload, entries: entries.slice(0, 10) }),
    '2de8771ee983cbbc27ed9eee8497ecf190ba2fc0679202318eeb359bb4718b90');
  assert.equal(canonicalSha256({ ...dev.payload, entries: entries.slice(0, 15) }),
    '371585c8ac295f044eb2aab0212f8bf359169ba3515fd6e70331443568dace4b');
  assert.equal(holdout.payload.entries.length, 0);
  assert.equal(holdout.payload.targetCount, 20);
  for (const value of entries) {
    assert.equal(value.review.status, 'reviewed');
    assert.equal(value.review.reviewRoundCount, 1);
    assert.equal(value.review.reviewerRoleId, 'author-review');
    assert.ok(Number.isFinite(Date.parse(value.review.reviewedAt ?? '')));
    assert.equal(value.currentEffectiveCorrection, false);
    assert.equal(value.evidenceGroups.length, 1);
    assert.equal(value.evidenceGroups[0]?.evidenceGroupId, 'G1');
    assert.equal(value.evidenceGroups[0]?.grade, 2);
    assert.equal(value.evidenceGroups[0]?.acceptableChunks.length, 1);
  }
  assert.deepEqual(entries.slice(5, 10).map(value => value.categories), [
    ['profit', 'numeric', 'period', 'table_targeted'],
    ['capex', 'period', 'table_targeted'],
    ['contract_customer', 'numeric', 'period', 'paraphrase'],
    ['dividend', 'cash_flow', 'period', 'synonym'],
    ['segment', 'synonym', 'lexical_sparse'],
  ]);
  assert.deepEqual(entries.slice(5, 10).map(value => value.evidenceModality), [
    'table', 'table', 'narrative', 'narrative', 'narrative',
  ]);
  for (const [index, value] of entries.entries()) {
    assert.equal(value.split, 'dev');
    const reviewedAt = [
      '2026-11-06T10:31:54Z', '2026-11-06T11:31:37Z',
      '2026-11-11T11:07:52Z', '2026-11-11T14:27:06Z',
    ];
    assert.equal(value.review.reviewedAt, reviewedAt[Math.floor(index / 5)]);
  }
  const third = entries.slice(10, 15);
  assert.deepEqual(third.map(value => value.queryText), [
    '삼성전자 2025년 사업보고서의 연구개발비용 표에서 연구개발비/매출액 비율은 제57기와 제56기에 각각 몇 %인가?',
    '삼성전자 2026년 반기보고서에서 주요 유동성 공급원은 무엇이며, 주요 유동성 수요로 어떤 용도를 설명하는가?',
    '삼성전자 2026년 반기보고서에 따르면 모바일용 메모리와 TV·모니터용 디스플레이 패널 가격은 전년 연간평균 대비 각각 어떻게 변했는가?',
    'SK하이닉스 2026년 1분기보고서는 계절적 비수기에도 사상 최대 실적과 최고 수익률을 기록한 배경을 수요·공급 환경과 제품 가격 측면에서 어떻게 설명하는가?',
    'SK하이닉스 2026년 1분기보고서의 환율 민감도 표에서 USD 행의 10% 상승 시와 10% 하락 시 금액은 각각 얼마인가? 표의 단위와 괄호 표기를 함께 제시해 주세요.',
  ]);
  assert.deepEqual(third.map(value => value.categories), [
    ['numeric', 'period', 'table_targeted'],
    ['debt_liquidity', 'cash_flow', 'paraphrase'],
    ['numeric', 'period'],
    ['causal', 'profit', 'period'],
    ['risk', 'numeric', 'table_targeted'],
  ]);
  assert.deepEqual(third.map(value => value.evidenceModality), [
    'table', 'narrative', 'narrative', 'narrative', 'table',
  ]);
  assert.deepEqual(third.map(value => value.reportFamily), [
    'annual', 'half_year', 'half_year', 'quarterly', 'quarterly',
  ]);
  assert.deepEqual(third.map(value => value.evidenceGroups[0]?.acceptableChunks[0]?.locator), [
    { entryName: '20260310002820.xml', firstBlockOrdinal: 254, lastBlockOrdinal: 254,
      tableId: 'tbl_924bbba964684bfef5914cf6c9b488f1', rowStart: 0, rowEnd: 5,
      repeatedHeaderRowStart: 0, repeatedHeaderRowEnd: 0 },
    { entryName: '20260814003699.xml', firstBlockOrdinal: 191, lastBlockOrdinal: 211 },
    { entryName: '20260814003699.xml', firstBlockOrdinal: 123, lastBlockOrdinal: 123 },
    { entryName: '20260515002287.xml', firstBlockOrdinal: 67, lastBlockOrdinal: 67 },
    { entryName: '20260515002287.xml', firstBlockOrdinal: 119, lastBlockOrdinal: 119,
      tableId: 'tbl_767e42bb2ad003c76eb9f8eb759f6d8a', rowStart: 0, rowEnd: 5,
      repeatedHeaderRowStart: 0, repeatedHeaderRowEnd: 1 },
  ]);
  const fourth = entries.slice(15);
  assert.deepEqual(fourth.map(value => value.queryText), [
    '삼성전자 2025년 사업보고서의 제57기 가동률 표에서 DS 부문 메모리와 SDC 디스플레이 패널의 가동률은 각각 몇 %인가?',
    'SK하이닉스 2026년 1분기보고서의 주요 원재료 현황 표에서 Wafer, Substrate, PCB의 투입액 비율은 각각 몇 %인가?',
    '삼성전자 2025년 사업보고서의 제재 현황 표에서 2024년 4월 7일 공정거래위원회가 당사에 내린 조치와 그 근거 법률 조항은 무엇인가?',
    '삼성전자 2025년 사업보고서는 국내 연구개발에서 1~2년 내 상품화 기술, 3~5년 내 중장기 기술, 미래 성장엔진의 핵심 요소 기술을 각각 어느 조직이 담당한다고 설명하는가?',
    'SK하이닉스 2026년 1분기보고서는 웨이퍼 가격이 무엇의 영향을 받으며, 원가 경쟁력 강화와 급격한 수요 변화에 대응하기 위해 어떤 방침을 제시하는가?',
  ]);
  assert.deepEqual(fourth.map(value => value.categories), [
    ['numeric', 'period', 'table_targeted'],
    ['numeric', 'period', 'table_targeted'],
    ['regulation_litigation', 'period', 'table_targeted'],
    ['period', 'paraphrase'],
    ['risk', 'contract_customer', 'paraphrase'],
  ]);
  assert.deepEqual(fourth.map(value => value.evidenceModality), [
    'table', 'table', 'table', 'narrative', 'narrative',
  ]);
  assert.deepEqual(fourth.map(value => value.reportFamily), [
    'annual', 'quarterly', 'annual', 'annual', 'quarterly',
  ]);
  assert.deepEqual(fourth.map(value => value.evidenceGroups[0]?.acceptableChunks[0]?.locator), [
    { entryName: '20260310002820.xml', firstBlockOrdinal: 154, lastBlockOrdinal: 154,
      tableId: 'tbl_460e01439332247e8a5897c2c6a33592', rowStart: 0, rowEnd: 3,
      repeatedHeaderRowStart: 0, repeatedHeaderRowEnd: 1 },
    { entryName: '20260515002287.xml', firstBlockOrdinal: 72, lastBlockOrdinal: 72,
      tableId: 'tbl_2cf6c7ba3491c273f3f32d5c3e4b8728', rowStart: 0, rowEnd: 7,
      repeatedHeaderRowStart: 0, repeatedHeaderRowEnd: 0 },
    { entryName: '20260310002820.xml', firstBlockOrdinal: 2555, lastBlockOrdinal: 2555,
      tableId: 'tbl_6f5a1db3ee4b811c0a5e1aefbd68055d', rowStart: 0, rowEnd: 3,
      repeatedHeaderRowStart: 0, repeatedHeaderRowEnd: 0 },
    { entryName: '20260310002820.xml', firstBlockOrdinal: 256, lastBlockOrdinal: 259 },
    { entryName: '20260515002287.xml', firstBlockOrdinal: 73, lastBlockOrdinal: 81 },
  ]);
  assert.equal(new Set(entries.map(value => value.queryText)).size, 20);
  const coverage = evaluateDatasetCoverage(entries);
  assert.deepEqual(coverage.modalityCounts, { narrative: 11, table: 9 });
  assert.deepEqual(coverage.companyCounts, { '00126380:005930': 11, '00164779:000660': 9 });
  assert.deepEqual(coverage.reportFamilyCounts, { annual: 7, half_year: 4, quarterly: 9 });
  assert.equal(coverage.categories.regulation_litigation, 1);
  const categories = new Set<string>(entries.flatMap(value => value.categories));
  for (const category of ['causal', 'risk', 'numeric', 'period', 'table_targeted']) {
    assert.ok(categories.has(category), category);
  }
  assert.equal(assessDatasetReadiness(dev, holdout).ready, false);
});

test('current-effective evidence seam detects missing pinned chunks', () => {
  const value = entry();
  const absent = validateCurrentEffectiveEvidence(value, new Set());
  assert.equal(absent.compatible, false);
  const key = absent.missingChunkKeys[0]!;
  assert.deepEqual(validateCurrentEffectiveEvidence(value, new Set([key])), { compatible: true, missingChunkKeys: [] });
});

test('fixed historical-source annotation parses without family or graph fields', () => {
  const historical = entry({
    queryText: 'What products did synthetic receipt 20260319000001 describe?',
    currentEffectiveCorrection: false,
    notes: 'Synthetic historical-source test only; not current-validity or human approval evidence.',
    review: { status: 'pending', reviewRoundCount: 0 },
  });
  const parsed = parseDatasetEnvelope(envelope(historical), 'dev').payload.entries[0]!;
  assert.deepEqual(parsed, historical);
  assert.equal(evaluateDatasetCoverage([parsed]).correctionCount, 0);
  assert.throws(() => evaluateRankedCandidates(parsed, []), code('PENDING_ANNOTATION'));
});

for (const currentEffectiveCorrection of [false, true]) {
  test(`correction coverage flag ${currentEffectiveCorrection} cannot bypass review or establish current evidence`, () => {
    const value = entry({ currentEffectiveCorrection });
    const parsed = parseDatasetEnvelope(envelope(value), 'dev').payload.entries[0]!;
    assert.equal(evaluateDatasetCoverage([parsed]).correctionCount, Number(currentEffectiveCorrection));
    assert.deepEqual(evaluateRankedCandidates(parsed, []), evaluateRankedCandidates(entry(), []));
    const absent = validateCurrentEffectiveEvidence(parsed, new Set());
    assert.equal(absent.compatible, false);
    assert.equal(absent.missingChunkKeys.length, 1);
    for (const status of ['reviewed', 'sealed'] as const) {
      const split = status === 'sealed' ? 'holdout' : 'dev';
      const missingMetadata = entry({ currentEffectiveCorrection, split,
        queryId: split === 'dev' ? 'DEV-001' : 'HOLD-001',
        review: { status, reviewRoundCount: status === 'sealed' ? 2 : 1 },
      });
      assert.throws(() => parseDatasetEnvelope(envelope(missingMetadata, split), split),
        code('DATASET_REVIEW_EVIDENCE_INVALID'));
      assert.throws(() => evaluateRankedCandidates(missingMetadata, []),
        code('DATASET_REVIEW_EVIDENCE_INVALID'));
    }
    const pending = entry({ currentEffectiveCorrection, review: { status: 'pending', reviewRoundCount: 0 } });
    assert.throws(() => evaluateRankedCandidates(pending, []), code('PENDING_ANNOTATION'));
  });
}

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
