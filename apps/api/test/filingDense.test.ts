import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeDenseVector, denseGenerationFingerprint, denseInputFingerprint,
  denseInputManifestFingerprint, denseVectorFingerprint } from '../src/filingIntelligence/dense/fingerprints.js';
import { denseSimilarityFromCosineDistance } from '../src/filingIntelligence/dense/filingDenseRetrievalRepository.js';
import { FILING_DENSE_DIMENSION, FILING_DENSE_PROFILES,
  getFilingDenseProfile } from '../src/filingIntelligence/dense/profile.js';
import { prepareDenseVector } from '../src/filingIntelligence/dense/vector.js';

test('dense registry contains immutable benchmark candidates without a production winner', () => {
  const profiles = Object.values(FILING_DENSE_PROFILES);
  assert.equal(profiles.length, 2);
  assert.deepEqual(profiles.map(value => value.dimensions), [1536, 1536]);
  assert.deepEqual(profiles.map(value => value.distanceMetric), ['cosine', 'cosine']);
  assert.equal(new Set(profiles.map(value => value.profileId)).size, 2);
  assert.equal(profiles.every(value => /^[0-9a-f]{64}$/.test(value.profileFingerprint)), true);
  assert.equal(getFilingDenseProfile(profiles[0]!.profileId), profiles[0]);
  assert.equal(FILING_DENSE_DIMENSION, 1536);
});

test('dense fingerprints are deterministic and evidence-sensitive', () => {
  const profile = FILING_DENSE_PROFILES.openAiSmall1536;
  const chunk = { chunkId: 'chunk-a', contentHash: 'a'.repeat(64), retrievalText: '사업의 내용\n\nHBM 수익성' };
  const input = denseInputFingerprint(profile, 'b'.repeat(64), chunk);
  assert.equal(input, denseInputFingerprint(profile, 'b'.repeat(64), chunk));
  assert.notEqual(input, denseInputFingerprint(profile, 'b'.repeat(64), { ...chunk, retrievalText: `${chunk.retrievalText}!` }));
  const manifest = denseInputManifestFingerprint(profile, [{
    chunkRowId: '1', ordinal: 0, ...chunk, inputFingerprint: input,
  }]);
  const vector = Array.from({ length: 1536 }, (_, index) => (index % 17 + 1) / 100);
  const vectorFingerprint = denseVectorFingerprint(vector);
  assert.notEqual(vectorFingerprint, denseVectorFingerprint(vector.map((value, index) => index === 0 ? value + 0.01 : value)));
  const generation = { profileFingerprint: profile.profileFingerprint, representationFingerprint: 'b'.repeat(64),
    inputManifestFingerprint: manifest, dimension: 1536,
    vectors: [{ chunkId: chunk.chunkId, inputFingerprint: input, vectorFingerprint }] };
  assert.equal(denseGenerationFingerprint(generation), denseGenerationFingerprint(generation));
});

test('dense vector fingerprints use normalized float32 bytes', () => {
  const rounded = Math.fround(0.123456789012345);
  assert.deepEqual(canonicalizeDenseVector([0.123456789012345, -0]), [rounded, 0]);
  assert.equal(denseVectorFingerprint([0.123456789012345, -0]), denseVectorFingerprint([rounded, 0]));
  assert.equal(denseVectorFingerprint([0]), denseVectorFingerprint([-0]));
  assert.throws(() => canonicalizeDenseVector([Number.NaN]), TypeError);
  assert.throws(() => canonicalizeDenseVector([Number.POSITIVE_INFINITY]), TypeError);
  assert.throws(() => canonicalizeDenseVector([Number.MAX_VALUE]), TypeError);
});

test('dense pgvector serialization accepts only canonical nonzero 1536 vectors', () => {
  const input = Array.from({ length: 1536 }, (_, index) => index === 0
    ? 0.123456789012345 : index === 1 ? -0 : 0);
  const prepared = prepareDenseVector(input);
  assert.equal(prepared.values.length, 1536);
  assert.equal(prepared.values[0], Math.fround(input[0]!));
  assert.equal(Object.is(prepared.values[1], -0), false);
  assert.deepEqual(JSON.parse(prepared.pgVector) as number[], prepared.values);
  assert.equal(prepared.fingerprint, denseVectorFingerprint(prepared.values));
  for (const invalid of [
    Array(1535).fill(0.1),
    Array(1537).fill(0.1),
    Array(1536).fill(0),
    Array(1536).fill(Number.NaN),
    Array(1536).fill(Number.POSITIVE_INFINITY),
    Array(1536).fill(Number.MAX_VALUE),
  ]) {
    assert.throws(() => prepareDenseVector(invalid), (value: unknown) =>
      typeof value === 'object' && value !== null && 'code' in value
      && value.code === 'FILING_DENSE_VECTOR_INVALID');
  }
});

test('dense similarity validates cosine distance and clamps epsilon noise', () => {
  assert.equal(denseSimilarityFromCosineDistance(0), 1);
  assert.equal(denseSimilarityFromCosineDistance(1), 0);
  assert.equal(denseSimilarityFromCosineDistance(2), -1);
  assert.equal(denseSimilarityFromCosineDistance(-5e-7), 1);
  assert.equal(denseSimilarityFromCosineDistance(2 + 5e-7), -1);
  for (const invalid of [-2e-6, 2 + 2e-6, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => denseSimilarityFromCosineDistance(invalid), (value: unknown) =>
      typeof value === 'object' && value !== null && 'code' in value
      && value.code === 'FILING_DENSE_RETRIEVAL_INTEGRITY_FAILURE');
  }
});
