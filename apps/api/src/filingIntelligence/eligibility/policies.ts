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

export const REPRESENTATION_POLICY_ID = 'filing-canonical-opendart-v1';
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

export type RepresentationPolicy = typeof FILING_REPRESENTATION_POLICY;
export type RetrievalPolicy = typeof FILING_RETRIEVAL_POLICY;

export function getRepresentationPolicy(policyId: string): RepresentationPolicy {
  if (policyId !== REPRESENTATION_POLICY_ID) {
    throw new FilingEligibilityError('FILING_ELIGIBILITY_POLICY_UNKNOWN', false);
  }
  return FILING_REPRESENTATION_POLICY;
}

export function getRetrievalPolicy(policyId: string): RetrievalPolicy {
  if (policyId !== RETRIEVAL_POLICY_ID) {
    throw new FilingEligibilityError('FILING_ELIGIBILITY_POLICY_UNKNOWN', false);
  }
  return FILING_RETRIEVAL_POLICY;
}
