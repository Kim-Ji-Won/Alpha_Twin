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
import { canonicalToEvaluationLocator, evaluationToCanonicalLocator } from '../evaluation/filingDense/evaluationLocator.js';

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

test('first seven dev tranches preserve author review and historical-source coverage', async () => {
  const { dev, holdout } = await loadFinalDecisionDatasets(ROOT, { allowSealedHoldout: true });
  const entries = dev.payload.entries;
  assert.deepEqual(entries.map(value => value.queryId), [
    'DEV-001', 'DEV-002', 'DEV-003', 'DEV-004', 'DEV-005',
    'DEV-006', 'DEV-007', 'DEV-008', 'DEV-009', 'DEV-010',
    'DEV-011', 'DEV-012', 'DEV-013', 'DEV-014', 'DEV-015',
    'DEV-016', 'DEV-017', 'DEV-018', 'DEV-019', 'DEV-020',
    'DEV-021', 'DEV-022', 'DEV-023', 'DEV-024', 'DEV-025',
    'DEV-026', 'DEV-027', 'DEV-028', 'DEV-029', 'DEV-030',
    'DEV-031', 'DEV-032', 'DEV-033', 'DEV-034', 'DEV-035',
  ]);
  assert.equal(entries.length, 35);
  assert.equal(new Set(entries.map(value => value.queryId)).size, 35);
  assert.equal(dev.payload.datasetId, 'dense-eval-v1');
  assert.equal(dev.payload.targetCount, 40);
  assert.equal(dev.payload.schemaVersion, 'dense-eval-dataset@1');
  assert.equal(dev.canonicalHash, canonicalSha256(dev.payload));
  // Preserve previously approved payloads, including every pin and review.
  assert.equal(canonicalSha256({ ...dev.payload, entries: entries.slice(0, 10) }),
    '2de8771ee983cbbc27ed9eee8497ecf190ba2fc0679202318eeb359bb4718b90');
  assert.equal(canonicalSha256({ ...dev.payload, entries: entries.slice(0, 15) }),
    '371585c8ac295f044eb2aab0212f8bf359169ba3515fd6e70331443568dace4b');
  assert.equal(canonicalSha256({ ...dev.payload, entries: entries.slice(0, 20) }),
    'b9ae65d8d2bcae35afc4ecfaafc902ea02bf0a9b4fd0e6afa4583ec33febbfa1');
  assert.equal(canonicalSha256({ ...dev.payload, entries: entries.slice(0, 25) }),
    '2ac0c7008c28269d0bbde6f2f3ffe2a017225c3d028a244edf523c830211db4c');
  assert.equal(canonicalSha256({ ...dev.payload, entries: entries.slice(0, 30) }),
    '42c4df5e5e43d40a4bc9a5db5e549366fa462ac948d4bf7fc7fe3c443205272b');
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
      '2026-11-12T02:40:43Z', '2026-11-15T06:14:18Z',
      '2026-11-16T12:17:09Z',
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
  const fourth = entries.slice(15, 20);
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
  const fifth = entries.slice(20, 25);
  assert.deepEqual(fifth.map(value => value.queryText), [
    '삼성전자 2026년 반기보고서의 연결 재무상태표에서 제58기 반기말 현금및현금성자산과 단기금융상품은 각각 얼마인가? 표의 백만원 단위로 답하라.',
    '삼성전자 2026년 반기보고서의 연결 손익계산서에서 제58기 반기 누적 매출액과 반기순이익은 각각 얼마인가? 3개월 열이 아닌 누적 열을 백만원 단위로 읽어라.',
    'SK하이닉스 2026년 1분기보고서는 직판 거래와 대리점 거래를 실수요자에게 판매하는 방식에 따라 어떻게 구분하는가?',
    '삼성전자 2026년 반기보고서는 2025년에 매입한 자기주식 중 임직원 보상 목적을 제외한 주식의 소각 규모와 시기를 어떻게 기재하는가?',
    '삼성전자 2026년 반기보고서의 녹색경영 설명에 따르면, 법규에 따라 정부에 신고하는 두 정보는 무엇이며 이해관계자에게 어떤 보고서로 공개하는가?',
  ]);
  assert.deepEqual(fifth.map(value => value.categories), [
    ['debt_liquidity', 'numeric', 'period', 'table_targeted'],
    ['profit', 'numeric', 'period', 'table_targeted'],
    ['contract_customer', 'paraphrase'],
    ['dividend', 'numeric', 'period'],
    ['regulation_litigation', 'paraphrase'],
  ]);
  assert.deepEqual(fifth.map(value => value.evidenceModality), [
    'table', 'table', 'narrative', 'narrative', 'narrative',
  ]);
  assert.deepEqual(fifth.map(value => value.reportFamily), [
    'half_year', 'half_year', 'quarterly', 'half_year', 'half_year',
  ]);
  // Frozen from Issue #17 candidate audit; each hash binds every approved pin field.
  assert.deepEqual(fifth.map(value => canonicalSha256(value.evidenceGroups[0]?.acceptableChunks[0])), [
    '21c250f110a91febdfa6c07a588fa498da8226a3a7e24c0079e112554cc48d73',
    '028062a562c397968d66b4b985ba79276db82f5b867a2a96a31f9333f5559e1f',
    'dbafba46db70f57197272702219a2d7f749e9b9e642adf51cb97e4678803c04b',
    'abf154300cd127639875785f9597d3a43b3ee1ea4810fc00d7ffceb28bad4061',
    '64b6c5b014737eb398186a042f5559d8ab91c49e1c6fbf687d3681fa4660f82d',
  ]);
  const fifthLocators = fifth.map(value => value.evidenceGroups[0]!.acceptableChunks[0]!.locator);
  const canonicalLocators = [
    { entryName: '20260814003699.xml', firstBlockOrdinal: 358, lastBlockOrdinal: 358,
      tableId: 'tbl_9fd25812cad87d7fe0094e7adf1dd885', rowRange: [0, 52], repeatedHeaderRowRange: [0, 0] },
    { entryName: '20260814003699.xml', firstBlockOrdinal: 360, lastBlockOrdinal: 360,
      tableId: 'tbl_4db91f7ee6901706c347cefc9dd4e141', rowRange: [0, 20], repeatedHeaderRowRange: [0, 1] },
    { entryName: '20260515002287.xml', firstBlockOrdinal: 102, lastBlockOrdinal: 112 },
    { entryName: '20260814003699.xml', firstBlockOrdinal: 1352, lastBlockOrdinal: 1362 },
    { entryName: '20260814003699.xml', firstBlockOrdinal: 2094, lastBlockOrdinal: 2098 },
  ];
  assert.deepEqual(fifthLocators.map(evaluationToCanonicalLocator), canonicalLocators);
  for (const locator of fifthLocators) {
    assert.deepEqual(canonicalToEvaluationLocator(evaluationToCanonicalLocator(locator)), locator);
  }
  assert.match(fifth[0]!.notes!, /adjacent source block 357, not inside the pinned chunk/);
  assert.match(fifth[1]!.notes!, /adjacent block 359, not the pinned chunk/);
  assert.match(fifth[3]!.notes!, /treasury-share cancellation, not cash dividends/);
  assert.match(fifth[4]!.notes!, /environmental reporting\/disclosure, not litigation, sanctions or violations/);
  const sixth = entries.slice(25, 30);
  assert.deepEqual(sixth.map(value => value.queryText), [
    '삼성전자 2025년 사업보고서의 주요 계약 표는 Google EMADA의 체결시기 및 기간과 적용 지역·앱 사용 범위를 어떻게 기재하는가?',
    '삼성전자 2025년 사업보고서의 연결 현금흐름표에서 제57기(2025년 연간) 유형자산의 취득은 얼마로 표시되어 있는가? 백만원 단위와 괄호 표기를 유지해 답하라.',
    'SK하이닉스 2026년 1분기보고서는 칩을 지지하고 외부 습기·충격으로부터 보호하는 패키지 원재료를 무엇이라고 설명하는가?',
    'SK하이닉스 2026년 1분기보고서는 국가핵심기술 또는 전략기술로 지정된 반도체 기술을 해외로 이전할 때 수출자에게 어떤 행정 절차가 필요하다고 설명하는가?',
    'SK하이닉스 2026년 1분기보고서는 2025년 PC 교체 수요를 이끈 운영체제 지원 관련 사건이 무엇이며 언제 발생했다고 기재하는가?',
  ]);
  assert.deepEqual(sixth.map(value => value.categories), [
    ['contract_customer', 'period', 'table_targeted'],
    ['cash_flow', 'capex', 'numeric', 'period', 'table_targeted'],
    ['paraphrase'],
    ['regulation_litigation', 'paraphrase'],
    ['causal', 'period', 'paraphrase'],
  ]);
  assert.deepEqual(sixth.map(value => value.evidenceModality), [
    'table', 'table', 'narrative', 'narrative', 'narrative',
  ]);
  assert.deepEqual(sixth.map(value => value.reportFamily), [
    'annual', 'annual', 'quarterly', 'quarterly', 'quarterly',
  ]);
  // Frozen from Issue #19 candidate audit, independently of the authored dataset.
  assert.deepEqual(sixth.map(value => canonicalSha256(value.evidenceGroups[0]?.acceptableChunks[0])), [
    '1c6c754f7cad68801b66621767dce5b6eb51ab97f4b082d495099b0b40cdfb0a',
    '768ffa8e75403ab33630fc0904239240d91b8f0f7bc84cc929f8b1622e73ca28',
    'e6f3f4428564fb90867ff10ce3aee151904c35173d62336056ce8154d7bb42cb',
    'a82f595537368dc1a468973e120b5015bfa1c8d56e97b6084f4d321c004f560a',
    'bd4490999fe898a6061de1d32bfc2a7af3878e4f0117e6a79c2ea57b85f827bc',
  ]);
  const sixthLocators = sixth.map(value => value.evidenceGroups[0]!.acceptableChunks[0]!.locator);
  assert.deepEqual(sixthLocators.map(evaluationToCanonicalLocator), [
    { entryName: '20260310002820.xml', firstBlockOrdinal: 250, lastBlockOrdinal: 250,
      tableId: 'tbl_bcb9a1b3d8d12066bb1e6bb3186679d0', rowRange: [0, 19], repeatedHeaderRowRange: [0, 0] },
    { entryName: '20260310002820.xml', firstBlockOrdinal: 394, lastBlockOrdinal: 394,
      tableId: 'tbl_aa55780a632133dd29ce6b3196122629', rowRange: [0, 42], repeatedHeaderRowRange: [0, 0] },
    { entryName: '20260515002287.xml', firstBlockOrdinal: 68, lastBlockOrdinal: 70 },
    { entryName: '20260515002287.xml', firstBlockOrdinal: 200, lastBlockOrdinal: 212 },
    { entryName: '20260515002287.xml', firstBlockOrdinal: 192, lastBlockOrdinal: 192 },
  ]);
  for (const locator of sixthLocators) {
    assert.deepEqual(canonicalToEvaluationLocator(evaluationToCanonicalLocator(locator)), locator);
  }
  assert.match(sixth[0]!.notes!, /Europe 32 countries \(EEA\).*not current country counts, contract validity or renewal/);
  assert.match(sixth[1]!.notes!, /\(47,522,179\) million KRW for FY2025 preserves parentheses/);
  assert.match(sixth[1]!.notes!, /2025-01-01 to 2025-12-31.*adjacent block 393, not the pinned chunk at block 394/);
  assert.match(sixth[1]!.notes!, /Not total capital expenditure/);
  assert.match(sixth[2]!.notes!, /Substrate.*protecting and supporting.*no additional numeric or performance claim/);
  assert.match(sixth[3]!.notes!, /approval OR notification.*not a universal duty.*or a freely selectable procedure/);
  assert.match(sixth[3]!.notes!, /No current legal applicability judgment/);
  assert.match(sixth[4]!.notes!, /October 2025 Windows10.*one of several.*not the sole cause/);
  const seventh = entries.slice(30, 35);
  assert.deepEqual(seventh.map(value => value.queryText), [
    '삼성전자 2026년 반기보고서의 시설투자 표에서 2026년 1~6월 DS 부문과 SDC의 투자액은 각각 얼마인가? (단위: 억원)',
    '삼성전자 2026년 반기보고서의 주요 지역별 매출 현황에서 제58기 반기 별도 기준 국내 내수 매출과 중국 수출 매출은 각각 얼마인가? (단위: 억원)',
    '삼성전자 2026년 반기보고서의 자본위험 관리 표에 제58기 반기말과 제57기말 부채비율은 각각 몇 %로 기재되어 있는가?',
    'SK하이닉스 2026년 1분기보고서의 연결 기준 연구개발비용 표에서 제79기 1분기에 비용으로 처리한 연구개발비와 무형자산으로 처리한 개발비는 각각 얼마인가? (단위: 백만원)',
    'SK하이닉스 2026년 1분기보고서의 주요 배당지표 표에서 제79기 1분기 보통주 주당 현금배당금과 현금배당금총액은 각각 얼마로 기재되어 있는가?',
  ]);
  assert.deepEqual(seventh.map(value => value.categories), [
    ['capex', 'numeric', 'period', 'table_targeted'],
    ['segment', 'numeric', 'period', 'table_targeted'],
    ['debt_liquidity', 'numeric', 'period', 'table_targeted'],
    ['numeric', 'period', 'table_targeted'],
    ['dividend', 'numeric', 'period', 'table_targeted'],
  ]);
  assert.equal(seventh[3]!.categories.includes('profit'), false);
  assert.deepEqual(seventh.map(value => value.company), [
    { corpCode: '00126380', symbol: '005930' },
    { corpCode: '00126380', symbol: '005930' },
    { corpCode: '00126380', symbol: '005930' },
    { corpCode: '00164779', symbol: '000660' },
    { corpCode: '00164779', symbol: '000660' },
  ]);
  assert.deepEqual(seventh.map(value => value.evidenceModality), [
    'table', 'table', 'table', 'table', 'table',
  ]);
  assert.deepEqual(seventh.map(value => value.reportFamily), [
    'half_year', 'half_year', 'half_year', 'quarterly', 'quarterly',
  ]);
  // Frozen from Issue #21 comment 6915819429, not from the authored dataset.
  assert.deepEqual(seventh.map(value => canonicalSha256(value.evidenceGroups[0]?.acceptableChunks[0])), [
    'a3d34b2b4bb4410e5ba5229ec1a32007a4b3964943382e7b0bcff1702e93f414',
    'a53840b8d01c9c9be971d2623c9666608ba05c908fecc00a866ab7fc1bf2180e',
    '65aa31c4c3e2b89eb449aabbb89acf2703aa7d486cb4fdb8f5cd03396037b45d',
    '0d3e3c2a18cd14b9781830f9aa48ad0c034b698352908d9f68a658c407d3bb18',
    '36258b752cfad48977061ccdd72d737bb7b314b64c6c1dcc648fc1fcf7f33607',
  ]);
  const seventhLocators = seventh.map(value => value.evidenceGroups[0]!.acceptableChunks[0]!.locator);
  assert.deepEqual(seventhLocators.map(evaluationToCanonicalLocator), [
    { entryName: '20260814003699.xml', firstBlockOrdinal: 152, lastBlockOrdinal: 152,
      tableId: 'tbl_4856260454bd2ef9f45a7fd418954b4a', rowRange: [0, 4], repeatedHeaderRowRange: [0, 0] },
    { entryName: '20260814003699.xml', firstBlockOrdinal: 168, lastBlockOrdinal: 168,
      tableId: 'tbl_85c8e82d84cfd35d0e2a281da1f054e0', rowRange: [0, 6], repeatedHeaderRowRange: [0, 0] },
    { entryName: '20260814003699.xml', firstBlockOrdinal: 218, lastBlockOrdinal: 218,
      tableId: 'tbl_b4b47524cff6868446bb9639191d1efe', rowRange: [0, 3], repeatedHeaderRowRange: [0, 0] },
    { entryName: '20260515002287.xml', firstBlockOrdinal: 145, lastBlockOrdinal: 145,
      tableId: 'tbl_19729ae579dfdf1515c3e8cd6eb01232', rowRange: [0, 10] },
    { entryName: '20260515002287.xml', firstBlockOrdinal: 1382, lastBlockOrdinal: 1382,
      tableId: 'tbl_d8371e1156d0cb295d3e5c6375321d33', rowRange: [0, 16], repeatedHeaderRowRange: [0, 1] },
  ]);
  for (const locator of seventhLocators) {
    assert.deepEqual(canonicalToEvaluationLocator(evaluationToCanonicalLocator(locator)), locator);
  }
  assert.equal(Object.hasOwn(seventhLocators[3]!, 'repeatedHeaderRowStart'), false);
  assert.equal(Object.hasOwn(seventhLocators[3]!, 'repeatedHeaderRowEnd'), false);
  for (const value of seventh) {
    assert.match(value.notes!, /Type A historical-source annotation only; no current-effective admission or benchmark approval/);
    assert.ok(value.notes!.length <= 500);
  }
  assert.match(seventh[0]!.notes!, /2026\.01~2026\.06.*inside pinned block 152.*unit.*adjacent block 151, outside the pin/);
  assert.match(seventh[0]!.notes!, /not property carrying amounts, cash-flow acquisitions or future plans/);
  assert.match(seventh[1]!.notes!, /58th half-year column.*pinned block 168.*unit.*block 167.*separate basis.*block 169, outside the pin/);
  assert.match(seventh[1]!.notes!, /China's row inherits the export rowspan context/);
  assert.match(seventh[1]!.notes!, /Not consolidated revenue, customer revenue or customer shares/);
  assert.match(seventh[2]!.notes!, /block 218.*31\.1%.*58th half-year end.*29\.9%.*57th year end/);
  assert.match(seventh[2]!.notes!, /Percent is not the million KRW unit.*debt\/equity.*block 217/);
  assert.match(seventh[2]!.notes!, /No ratio recalculation or current financial health assessment/);
  assert.match(seventh[3]!.notes!, /Period and accounting treatment.*block 145.*unit.*block 144.*consolidated basis.*block 146, outside the pin/);
  assert.match(seventh[3]!.notes!, /Row 0 is TD\/isHeader=false: no repeated header/);
  assert.match(seventh[3]!.notes!, /No profit category.*not cash spending, net income or total investment/);
  assert.match(seventh[4]!.notes!, /block 1382.*375 KRW\/share and 265,765 million KRW, with units inside the pin/);
  assert.match(seventh[4]!.notes!, /block 1376.*2026-04-22 board resolution after the report cutoff.*block 1383.*2026-05-31 record date.*actual total may change/);
  assert.match(seventh[4]!.notes!, /Not payment completion, a final total or current dividend rights/);
  assert.equal(new Set(entries.map(value => value.queryText)).size, 35);
  const coverage = evaluateDatasetCoverage(entries);
  assert.equal(coverage.total, 35);
  assert.equal(coverage.reviewed, 35);
  assert.equal(coverage.pending, 0);
  assert.equal(coverage.sealed, 0);
  assert.deepEqual(coverage.modalityCounts, { narrative: 17, table: 18 });
  assert.deepEqual(coverage.companyCounts, { '00126380:005930': 20, '00164779:000660': 15 });
  assert.deepEqual(coverage.reportFamilyCounts, { annual: 9, half_year: 11, quarterly: 15 });
  assert.deepEqual(coverage.categories, {
    causal: 4, segment: 4, profit: 3, capex: 3, cash_flow: 3, debt_liquidity: 4,
    dividend: 3, risk: 3, regulation_litigation: 3, contract_customer: 4, numeric: 18,
    period: 24, paraphrase: 11, synonym: 2, lexical_sparse: 1, table_targeted: 18,
  });
  assert.equal(coverage.correctionCount, 0);
  assert.deepEqual(coverage.errors, []);
  assert.deepEqual(coverage.warnings, [
    'CORRECTION_TARGET_NOT_MET', 'REPORT_FAMILY_TARGET_NOT_MET', 'MODALITY_TARGET_NOT_MET',
  ]);
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
