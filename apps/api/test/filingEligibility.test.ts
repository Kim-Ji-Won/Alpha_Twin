import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateEligibilityFingerprint } from '../src/filingIntelligence/eligibility/fingerprints.js';
import {
  FILING_REPRESENTATION_POLICY,
  FILING_RETRIEVAL_POLICY,
  getRepresentationPolicy,
  getRetrievalPolicy,
} from '../src/filingIntelligence/eligibility/policies.js';
import { FilingEligibilityError } from '../src/filingIntelligence/eligibility/errors.js';

function unknownPolicy(error: unknown): boolean {
  return error instanceof FilingEligibilityError
    && error.code === 'FILING_ELIGIBILITY_POLICY_UNKNOWN';
}

function fingerprintInput() {
  return {
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    retrievalPolicyFingerprint: FILING_RETRIEVAL_POLICY.fingerprint,
    representationPolicyId: FILING_REPRESENTATION_POLICY.policyId,
    representationPolicyFingerprint: FILING_REPRESENTATION_POLICY.fingerprint,
    documentId: '1', receiptId: '2', provider: 'opendart-fss',
    receiptNumber: '20990101000001', sourceEntryHash: 'a'.repeat(64),
    canonicalSchemaName: 'canonical-filing-document', canonicalSchemaVersion: '1',
    parserVersion: '1.0.1', chunkSchemaVersion: '1', chunkerVersion: '1.0.1',
    canonicalFingerprint: 'b'.repeat(64), chunkFingerprint: 'c'.repeat(64),
    representationFingerprint: 'd'.repeat(64), sectionCount: 1, blockCount: 2,
    chunkCount: 2, status: 'eligible' as const, reasonCode: 'eligible' as const,
    lexicalGeneration: {
      id: '3', profileId: 'ko-financial-ngrams-v1',
      schemaVersion: 'filing-lexical-index@1', normalizerVersion: '1.0.0',
      textSearchConfig: 'simple', status: 'ready', chunkCount: 2,
      lexicalFingerprint: 'e'.repeat(64), totalLexemeCount: 20,
    },
  };
}

test('filing policy registries are immutable, exact, and deterministic', () => {
  assert.equal(Object.isFrozen(FILING_REPRESENTATION_POLICY), true);
  assert.equal(Object.isFrozen(FILING_RETRIEVAL_POLICY), true);
  assert.equal(FILING_REPRESENTATION_POLICY.canonicalSchemaName, 'canonical-filing-document');
  assert.equal(FILING_REPRESENTATION_POLICY.canonicalSchemaVersion, '1');
  assert.equal(FILING_REPRESENTATION_POLICY.parserVersion, '1.0.1');
  assert.equal(FILING_REPRESENTATION_POLICY.chunkSchemaVersion, '1');
  assert.equal(FILING_REPRESENTATION_POLICY.chunkerVersion, '1.0.1');
  assert.equal(FILING_RETRIEVAL_POLICY.lexicalProfileId, 'ko-financial-ngrams-v1');
  assert.equal(FILING_RETRIEVAL_POLICY.denseProfileId, null);
  assert.equal(getRepresentationPolicy(FILING_REPRESENTATION_POLICY.policyId),
    FILING_REPRESENTATION_POLICY);
  assert.equal(getRetrievalPolicy(FILING_RETRIEVAL_POLICY.policyId), FILING_RETRIEVAL_POLICY);
  assert.match(FILING_REPRESENTATION_POLICY.fingerprint, /^[0-9a-f]{64}$/);
  assert.match(FILING_RETRIEVAL_POLICY.fingerprint, /^[0-9a-f]{64}$/);
});

test('unknown policy IDs fail with a typed error', () => {
  assert.throws(() => getRepresentationPolicy('unknown'), unknownPolicy);
  assert.throws(() => getRetrievalPolicy('unknown'), unknownPolicy);
});

test('eligibility fingerprint is deterministic and excludes time and revision', () => {
  const input = fingerprintInput();
  const first = calculateEligibilityFingerprint(input);
  assert.equal(calculateEligibilityFingerprint({ ...input }), first);
  assert.notEqual(calculateEligibilityFingerprint({
    ...input,
    chunkerVersion: '1.0.2',
  }), first);
  assert.notEqual(calculateEligibilityFingerprint({
    ...input,
    lexicalGeneration: { ...input.lexicalGeneration, lexicalFingerprint: 'f'.repeat(64) },
  }), first);
});
