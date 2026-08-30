import { createHash } from 'node:crypto';

import { FILING_REPRESENTATION_POLICY } from '../eligibility/policies.js';
import { serializeJson } from '../persistence/fingerprints.js';

export const FILING_DENSE_DIMENSION = 1536 as const;

const common = {
  profileVersion: '1.0.0', provider: 'openai', dimensions: FILING_DENSE_DIMENSION,
  distanceMetric: 'cosine', documentFormatterVersion: 'retrieval-text-only@1',
  queryFormatterVersion: 'query-text-only@1', normalization: 'provider-native',
  maximumInputCharacters: 2_400, maximumInputsPerBatch: 100,
  representationPolicyId: FILING_REPRESENTATION_POLICY.policyId,
  representationPolicyFingerprint: FILING_REPRESENTATION_POLICY.fingerprint,
} as const;

function define(profileId: string, modelId: string) {
  const definition = Object.freeze({ profileId, ...common, modelId });
  return Object.freeze({ ...definition, profileFingerprint: createHash('sha256')
    .update(serializeJson(definition)).digest('hex') });
}

export const FILING_DENSE_PROFILES = Object.freeze({
  openAiSmall1536: define('ko-financial-dense-openai-te3-small-1536-v1', 'text-embedding-3-small'),
  openAiLargeReduced1536: define('ko-financial-dense-openai-te3-large-1536-v1', 'text-embedding-3-large'),
});

export type FilingDenseProfile = typeof FILING_DENSE_PROFILES[keyof typeof FILING_DENSE_PROFILES];

export function getFilingDenseProfile(profileId: string): FilingDenseProfile | undefined {
  return Object.values(FILING_DENSE_PROFILES).find(profile => profile.profileId === profileId);
}
