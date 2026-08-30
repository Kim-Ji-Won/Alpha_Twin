import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeDenseVector, denseGenerationFingerprint, denseInputFingerprint,
  denseInputManifestFingerprint, denseVectorFingerprint } from '../src/filingIntelligence/dense/fingerprints.js';
import { FILING_DENSE_DIMENSION, FILING_DENSE_PROFILES,
  getFilingDenseProfile } from '../src/filingIntelligence/dense/profile.js';

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
  const manifest = denseInputManifestFingerprint(profile, [{ ordinal: 0, chunkId: chunk.chunkId, inputFingerprint: input }]);
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
});
