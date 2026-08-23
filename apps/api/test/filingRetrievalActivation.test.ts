import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activationEventFingerprint,
  activationFingerprint,
} from '../src/filingIntelligence/activation/fingerprints.js';
import { activationActionFor } from '../src/filingIntelligence/activation/transitionPolicy.js';

const HASH = 'a'.repeat(64);
const state = {
  familyId: '1',
  retrievalPolicyId: 'filing-retrieval-lexical-v1',
  retrievalPolicyFingerprint: HASH,
  status: 'active' as const,
  receiptId: '2',
  documentId: '3',
  familyRevision: '4',
  familyFingerprint: HASH,
  resolutionFingerprint: HASH,
  resolverId: 'opendart-current-effective',
  resolverVersion: '1.0.0',
  manualControlRevision: null,
  selectionMode: 'automatic' as const,
  eligibilityRevision: '5',
  eligibilityFingerprint: HASH,
  representationPolicyId: 'filing-canonical-opendart-v1',
  representationPolicyFingerprint: HASH,
  representationFingerprint: HASH,
  lexicalGenerationId: '6',
  lexicalGenerationFingerprint: HASH,
};

test('activation fingerprints are deterministic and exclude revision/time', () => {
  const first = activationFingerprint(state);
  const second = activationFingerprint({ ...state });
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.notEqual(activationFingerprint({ ...state, documentId: '4' }), first);
});

test('history event fingerprints distinguish pointer transitions', () => {
  const fingerprint = activationFingerprint(state);
  const event = activationEventFingerprint({
    activation: state,
    activationFingerprint: fingerprint,
    eventType: 'switch',
    reasonCode: 'automatic_resolution',
    previousReceiptId: '1',
    previousDocumentId: '2',
  });
  assert.match(event, /^[0-9a-f]{64}$/);
  assert.notEqual(event, activationEventFingerprint({
    activation: state,
    activationFingerprint: fingerprint,
    eventType: 'refresh',
    reasonCode: 'representation_refresh',
    previousReceiptId: '1',
    previousDocumentId: '2',
  }));
});

test('resolution transition policy is exhaustive and fail closed', () => {
  assert.equal(activationActionFor('resolved'), 'evaluate');
  assert.equal(activationActionFor('manual_selected'), 'evaluate');
  assert.equal(activationActionFor('manual_hold'), 'deactivate');
  assert.equal(activationActionFor('terminal_legally_ineligible'), 'deactivate');
  for (const status of [
    'graph_incomplete', 'ambiguous_terminal_branch', 'legal_status_unresolved',
    'lineage_status_ineligible',
  ] as const) assert.equal(activationActionFor(status), 'retain');
  assert.equal(activationActionFor('family_not_found'), 'invalid');
});
