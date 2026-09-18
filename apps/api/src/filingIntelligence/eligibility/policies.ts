import { createHash } from 'node:crypto';

import {
  CANONICAL_FILING_SCHEMA_NAME,
  CANONICAL_FILING_SCHEMA_VERSION,
  FILING_CHUNKER_VERSION,
  FILING_CHUNK_SCHEMA_VERSION,
  FILING_XML_PARSER_VERSION,
} from '../../openDart/document/canonicalFilingContracts.js';
import { serializeJson } from '../persistence/fingerprints.js';
import { FILING_LEXICAL_PROFILE } from '../lexical/profile.js';
import { FilingEligibilityError } from './errors.js';
import { LEGACY_FILING_DECODING_PROFILE } from '../../openDart/document/filingXmlDecoding.js';
import { RESOLVER_ID, RESOLVER_VERSION } from '../resolution/contracts.js';
import { ACTIVE_FILING_SCOPE_ID, ACTIVE_FILING_SCOPE_VERSION } from '../activeScope/contracts.js';

export const REPRESENTATION_POLICY_ID = 'filing-canonical-opendart-v1';
export const LEGACY_REPRESENTATION_POLICY_ID =
  'filing-canonical-opendart-legacy-compatible-v1';
export const RETRIEVAL_POLICY_ID = 'filing-retrieval-lexical-v1';

function fingerprint(value: unknown): string {
  return createHash('sha256').update(serializeJson(value)).digest('hex');
}

const representationDefinition = Object.freeze({
  policyId: REPRESENTATION_POLICY_ID,
  semanticsVersion: '1',
  canonicalSchemaName: CANONICAL_FILING_SCHEMA_NAME,
  canonicalSchemaVersion: String(CANONICAL_FILING_SCHEMA_VERSION),
  parserVersion: FILING_XML_PARSER_VERSION,
  chunkSchemaVersion: String(FILING_CHUNK_SCHEMA_VERSION),
  chunkerVersion: FILING_CHUNKER_VERSION,
});

export const FILING_REPRESENTATION_POLICY = Object.freeze({
  ...representationDefinition,
  fingerprint: fingerprint(representationDefinition),
});

const legacyRepresentationDefinition = Object.freeze({
  ...representationDefinition,
  policyId: LEGACY_REPRESENTATION_POLICY_ID,
  semanticsVersion: '1',
  decodingProfileId: LEGACY_FILING_DECODING_PROFILE.profileId,
  decodingProfileFingerprint: LEGACY_FILING_DECODING_PROFILE.fingerprint,
});

export const LEGACY_FILING_REPRESENTATION_POLICY = Object.freeze({
  ...legacyRepresentationDefinition,
  fingerprint: fingerprint(legacyRepresentationDefinition),
});

const retrievalDefinition = Object.freeze({
  policyId: RETRIEVAL_POLICY_ID,
  semanticsVersion: '1',
  representationPolicyId: FILING_REPRESENTATION_POLICY.policyId,
  representationPolicyFingerprint: FILING_REPRESENTATION_POLICY.fingerprint,
  lexicalProfileId: FILING_LEXICAL_PROFILE.profileId,
  denseProfileId: null,
  hybridProfileId: null,
});

export const FILING_RETRIEVAL_POLICY = Object.freeze({
  ...retrievalDefinition,
  fingerprint: fingerprint(retrievalDefinition),
});

export type RepresentationPolicy = typeof FILING_REPRESENTATION_POLICY
  | typeof LEGACY_FILING_REPRESENTATION_POLICY;
export const RETRIEVAL_POLICY_V2_ID = 'filing-retrieval-lexical-v2';

export interface RepresentationPolicyPair {
  readonly policyId: string;
  readonly fingerprint: string;
}

export function canonicalRepresentationSet(
  pairs: readonly RepresentationPolicyPair[],
): readonly RepresentationPolicyPair[] {
  if (pairs.length === 0 || new Set(pairs.map(pair => pair.policyId)).size !== pairs.length) {
    throw new FilingEligibilityError('FILING_ELIGIBILITY_POLICY_UNKNOWN', false);
  }
  return Object.freeze(pairs.map(pair => {
    const registered = getRepresentationPolicy(pair.policyId);
    if (registered.fingerprint !== pair.fingerprint) {
      throw new FilingEligibilityError('FILING_ELIGIBILITY_POLICY_UNKNOWN', false);
    }
    return Object.freeze({ policyId: pair.policyId, fingerprint: pair.fingerprint });
  }).sort((a, b) => a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : 0));
}

export const LEXICAL_DEFINITION_DIGEST = fingerprint(FILING_LEXICAL_PROFILE);
const retrievalV2Definition = Object.freeze({
  policyId: RETRIEVAL_POLICY_V2_ID,
  semanticsVersion: '2',
  fingerprintSchema: 'filing-retrieval-policy@2',
  allowedRepresentations: canonicalRepresentationSet([
    FILING_REPRESENTATION_POLICY, LEGACY_FILING_REPRESENTATION_POLICY,
  ]),
  lexicalProfileId: FILING_LEXICAL_PROFILE.profileId,
  lexicalDefinitionDigest: LEXICAL_DEFINITION_DIGEST,
  admissionSemantics: 'exact-provenance-chunk-identity@1',
  eligibilitySemantics: 'matched-or-null@2',
  activationSemantics: 'unique-eligible-representation@1',
  resolverAuthority: `${RESOLVER_ID}@${RESOLVER_VERSION}`,
  activeScopeSemantics: `${ACTIVE_FILING_SCOPE_ID}@${ACTIVE_FILING_SCOPE_VERSION}`,
  vetoBoundsSemantics: 'live-hold-legal-veto-global-20@1',
});
export const FILING_RETRIEVAL_POLICY_V2 = Object.freeze({
  ...retrievalV2Definition,
  fingerprint: fingerprint(retrievalV2Definition),
});
export type RetrievalPolicy = typeof FILING_RETRIEVAL_POLICY | typeof FILING_RETRIEVAL_POLICY_V2;

export function allowedRepresentationPolicies(policy: RetrievalPolicy): readonly RepresentationPolicy[] {
  if (policy === FILING_RETRIEVAL_POLICY) return [FILING_REPRESENTATION_POLICY];
  if (policy !== FILING_RETRIEVAL_POLICY_V2) {
    throw new FilingEligibilityError('FILING_ELIGIBILITY_POLICY_UNKNOWN', false);
  }
  return policy.allowedRepresentations.map(pair => getRepresentationPolicy(pair.policyId));
}

export function getRepresentationPolicy(policyId: string): RepresentationPolicy {
  if (policyId === REPRESENTATION_POLICY_ID) return FILING_REPRESENTATION_POLICY;
  if (policyId === LEGACY_REPRESENTATION_POLICY_ID) {
    return LEGACY_FILING_REPRESENTATION_POLICY;
  }
  throw new FilingEligibilityError('FILING_ELIGIBILITY_POLICY_UNKNOWN', false);
}

export function getRetrievalPolicy(policyId: typeof RETRIEVAL_POLICY_ID): typeof FILING_RETRIEVAL_POLICY;
export function getRetrievalPolicy(policyId: typeof RETRIEVAL_POLICY_V2_ID): typeof FILING_RETRIEVAL_POLICY_V2;
export function getRetrievalPolicy(policyId: string): RetrievalPolicy;
export function getRetrievalPolicy(policyId: string): RetrievalPolicy {
  if (policyId === RETRIEVAL_POLICY_V2_ID) return FILING_RETRIEVAL_POLICY_V2;
  if (policyId !== RETRIEVAL_POLICY_ID) {
    throw new FilingEligibilityError('FILING_ELIGIBILITY_POLICY_UNKNOWN', false);
  }
  return FILING_RETRIEVAL_POLICY;
}
