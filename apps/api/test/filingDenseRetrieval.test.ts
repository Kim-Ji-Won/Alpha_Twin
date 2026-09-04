import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { FilingDenseError } from '../src/filingIntelligence/dense/errors.js';
import { denseInputFingerprint, denseInputManifestFingerprint } from '../src/filingIntelligence/dense/fingerprints.js';
import {
  DENSE_READINESS_SQL,
  EXACT_DENSE_RETRIEVAL_SQL,
  FilingDenseRetrievalRepository,
} from '../src/filingIntelligence/dense/filingDenseRetrievalRepository.js';
import { FILING_DENSE_PROFILES } from '../src/filingIntelligence/dense/profile.js';

const PROFILE = FILING_DENSE_PROFILES.openAiSmall1536;
const REPRESENTATION = 'a'.repeat(64);
const CHUNK = {
  chunkRowId: '3',
  ordinal: 0,
  chunkId: 'chunk-1',
  contentHash: 'b'.repeat(64),
  retrievalText: '검증된 dense chunk',
};
const INPUT_FINGERPRINT = denseInputFingerprint(PROFILE, REPRESENTATION, CHUNK);
const INPUT_MANIFEST = denseInputManifestFingerprint(PROFILE, [{
  ...CHUNK,
  inputFingerprint: INPUT_FINGERPRINT,
}]);

function readyRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    scope_ordinal: '1',
    requested_document_id: '1',
    document_id: '1',
    corp_code: '77777777',
    symbol: '777777',
    document_chunk_count: 1,
    stored_representation_fingerprint: REPRESENTATION,
    computed_representation_fingerprint: REPRESENTATION,
    generation_id: '2',
    dense_profile_id: PROFILE.profileId,
    dense_profile_fingerprint: PROFILE.profileFingerprint,
    generation_representation_fingerprint: REPRESENTATION,
    input_manifest_fingerprint: INPUT_MANIFEST,
    dimension: 1536,
    status: 'ready',
    expected_vector_count: 1,
    persisted_vector_count: 1,
    generation_fingerprint: 'c'.repeat(64),
    actual_vector_count: 1,
    chunks: [CHUNK],
    ...overrides,
  };
}

function repositoryWithRows(rows: readonly Readonly<Record<string, unknown>>[], onQuery?: () => void) {
  return new FilingDenseRetrievalRepository({
    async query(text: string, values?: unknown[]) {
      onQuery?.();
      assert.equal(text, DENSE_READINESS_SQL);
      assert.deepEqual(values, [['1'], PROFILE.profileId]);
      return { rows };
    },
  } as unknown as Pool);
}

const input = {
  corpCode: '77777777',
  symbol: '777777',
  documentIds: ['1'],
  denseProfileId: PROFILE.profileId,
} as const;

const isDenseError = (code: FilingDenseError['code']) => (value: unknown) =>
  value instanceof FilingDenseError && value.code === code;

test('dense readiness returns exact ready evidence with one bounded query', async () => {
  let calls = 0;
  const result = await repositoryWithRows([readyRow()], () => {
    calls += 1;
  }).resolveDenseReadiness(input);
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    status: 'ready',
    denseProfileId: PROFILE.profileId,
    denseProfileFingerprint: PROFILE.profileFingerprint,
    generations: [{
      documentId: '1',
      generationId: '2',
      generationFingerprint: 'c'.repeat(64),
      representationFingerprint: REPRESENTATION,
      inputManifestFingerprint: INPUT_MANIFEST,
      expectedVectorCount: 1,
    }],
  });
});

test('empty dense readiness is ready without a database query', async () => {
  const repository = new FilingDenseRetrievalRepository({
    async query() {
      throw new Error('database query must not run');
    },
  } as unknown as Pool);
  const result = await repository.resolveDenseReadiness({ ...input, documentIds: [] });
  assert.deepEqual(result.generations, []);
  assert.equal(result.status, 'ready');
});

test('missing, building, and failed dense generations are operational not-ready states', async t => {
  const cases = [
    { expected: 'generation_missing', row: readyRow({ generation_id: null }) },
    { expected: 'generation_building', row: readyRow({ status: 'building' }) },
    { expected: 'generation_failed', row: readyRow({ status: 'failed' }) },
  ] as const;
  for (const current of cases) {
    await t.test(current.expected, async () => {
      const result = await repositoryWithRows([current.row]).resolveDenseReadiness(input);
      assert.equal(result.status, 'not_ready');
      if (result.status !== 'not_ready') return;
      assert.deepEqual(result.generations, []);
      assert.deepEqual(result.reasons, [{ documentId: '1', reason: current.expected }]);
    });
  }
});

test('ready generation drift and malformed evidence fail closed', async t => {
  const cases = [
    readyRow({ dense_profile_fingerprint: 'd'.repeat(64) }),
    readyRow({ computed_representation_fingerprint: 'd'.repeat(64) }),
    readyRow({ generation_representation_fingerprint: 'd'.repeat(64) }),
    readyRow({ input_manifest_fingerprint: 'd'.repeat(64) }),
    readyRow({ expected_vector_count: 2 }),
    readyRow({ persisted_vector_count: 0 }),
    readyRow({ actual_vector_count: 0 }),
    readyRow({ generation_fingerprint: null }),
    readyRow({ generation_fingerprint: 'malformed' }),
  ];
  for (const [index, row] of cases.entries()) {
    await t.test(`integrity-${index + 1}`, async () => {
      await assert.rejects(repositoryWithRows([row]).resolveDenseReadiness(input),
        isDenseError('FILING_DENSE_GENERATION_INTEGRITY_FAILURE'));
    });
  }
});

test('dense readiness rejects unknown profiles, duplicate scope, overflow, and wrong ownership',
  async () => {
    const repository = repositoryWithRows([readyRow({ corp_code: '88888888' })]);
    await assert.rejects(repository.resolveDenseReadiness(input),
      isDenseError('FILING_DENSE_READINESS_SCOPE_FAILURE'));
    await assert.rejects(repository.resolveDenseReadiness({ ...input, denseProfileId: 'unknown' }),
      isDenseError('FILING_DENSE_READINESS_INVALID_INPUT'));
    await assert.rejects(repository.resolveDenseReadiness({ ...input, documentIds: ['1', '1'] }),
      isDenseError('FILING_DENSE_READINESS_INVALID_INPUT'));
    await assert.rejects(repository.resolveDenseReadiness({
      ...input,
      documentIds: Array.from({ length: 21 }, (_, index) => String(index + 1)),
    }), isDenseError('FILING_DENSE_READINESS_INVALID_INPUT'));
  });

test('exact dense retrieval accepts verified zero-candidate scope and rejects invalid bounds',
  async () => {
    let calls = 0;
    const repository = new FilingDenseRetrievalRepository({
      async query(text: string, values?: unknown[]) {
        calls += 1;
        assert.equal(text, EXACT_DENSE_RETRIEVAL_SQL);
        assert.equal(values?.[12], 8);
        return { rows: [{ requested_count: '1', verified_count: '1', document_id: null }] };
      },
    } as unknown as Pool);
    const generations = [{
      documentId: '1',
      generationId: '2',
      generationFingerprint: 'c'.repeat(64),
      representationFingerprint: REPRESENTATION,
      inputManifestFingerprint: INPUT_MANIFEST,
      expectedVectorCount: 0,
    }];
    const queryVector = Array<number>(1536).fill(0);
    queryVector[0] = 1;
    const common = {
      corpCode: '77777777',
      symbol: '777777',
      denseProfileId: PROFILE.profileId,
      denseProfileFingerprint: PROFILE.profileFingerprint,
      generations,
      queryVector,
    } as const;
    assert.deepEqual(await repository.retrieveDenseFilingChunks(common), []);
    assert.equal(calls, 1);
    await assert.rejects(repository.retrieveDenseFilingChunks({ ...common, topK: 21 }),
      isDenseError('FILING_DENSE_RETRIEVAL_INVALID_INPUT'));
    await assert.rejects(repository.retrieveDenseFilingChunks({
      ...common,
      queryVector: Array(1536).fill(0),
    }), isDenseError('FILING_DENSE_VECTOR_INVALID'));
    assert.equal(calls, 1);
  });
