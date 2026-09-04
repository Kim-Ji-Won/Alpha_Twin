import { createHash } from 'node:crypto';

import { serializeJson } from '../persistence/fingerprints.js';
import { DenseChunkInput } from './contracts.js';
import { FilingDenseProfile } from './profile.js';

const hash = (value: unknown) => createHash('sha256').update(serializeJson(value)).digest('hex');

export function denseInputFingerprint(profile: FilingDenseProfile, representationFingerprint: string,
  chunk: { chunkId: string; contentHash: string; retrievalText: string }): string {
  return hash({ profileFingerprint: profile.profileFingerprint, representationFingerprint,
    chunkId: chunk.chunkId, contentHash: chunk.contentHash, input: chunk.retrievalText });
}

export function denseInputManifestFingerprint(profile: FilingDenseProfile,
  values: readonly DenseChunkInput[]): string {
  return hash({ profileFingerprint: profile.profileFingerprint, chunks: values });
}

export function canonicalizeDenseVector(vector: readonly number[]): readonly number[] {
  return vector.map(value => {
    if (!Number.isFinite(value)) throw new TypeError('Dense vector values must be finite');
    const canonical = Math.fround(value);
    if (!Number.isFinite(canonical)) {
      throw new TypeError('Dense vector values must remain finite as float32');
    }
    return Object.is(canonical, -0) ? 0 : canonical;
  });
}

export function denseVectorFingerprint(vector: readonly number[]): string {
  const canonical = canonicalizeDenseVector(vector);
  const bytes = Buffer.allocUnsafe(canonical.length * 4);
  canonical.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return createHash('sha256').update(bytes).digest('hex');
}

export function denseGenerationFingerprint(input: { profileFingerprint: string;
  representationFingerprint: string; inputManifestFingerprint: string; dimension: number;
  vectors: readonly { chunkId: string; inputFingerprint: string; vectorFingerprint: string }[] }): string {
  return hash(input);
}
