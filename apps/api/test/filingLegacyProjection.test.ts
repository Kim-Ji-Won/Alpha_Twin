import assert from 'node:assert/strict';
import test from 'node:test';

import { activationFingerprint } from '../src/filingIntelligence/activation/fingerprints.js';
import { getRetrievalPolicy } from '../src/filingIntelligence/eligibility/policies.js';
import {
  LEGACY_PROJECTION_RETRIEVAL_POLICY_ID,
} from '../src/filingIntelligence/legacyProjection/contracts.js';
import { LegacyFilingProjectionError } from '../src/filingIntelligence/legacyProjection/errors.js';
import {
  LegacyProjectionSession,
  LegacyProjectionStore,
  ProjectionActivationRow,
  ProjectionDocumentRow,
  ProjectionEligibilityRow,
} from '../src/filingIntelligence/legacyProjection/legacyFilingProjectionRepository.js';
import { LegacyFilingProjectionService } from '../src/filingIntelligence/legacyProjection/legacyFilingProjectionService.js';

const ACTIVATED_AT = new Date('2099-06-01T00:00:00.000Z');
const HASHES = {
  family: '1'.repeat(64), resolution: '2'.repeat(64), eligibility: '3'.repeat(64),
  representation: '4'.repeat(64), generation: '5'.repeat(64),
};

function activation(overrides: Partial<ProjectionActivationRow> = {}): ProjectionActivationRow {
  const policy = getRetrievalPolicy(LEGACY_PROJECTION_RETRIEVAL_POLICY_ID);
  const base: ProjectionActivationRow = {
    family_id: '1', retrieval_policy_id: LEGACY_PROJECTION_RETRIEVAL_POLICY_ID,
    retrieval_policy_fingerprint: policy.fingerprint, status: 'active', receipt_id: '10',
    document_id: '100', family_revision: '1', family_fingerprint: HASHES.family,
    resolution_fingerprint: HASHES.resolution, resolver_id: 'verified-resolver',
    resolver_version: '1.0.0', manual_control_revision: null, selection_mode: 'automatic',
    eligibility_revision: '1', eligibility_fingerprint: HASHES.eligibility,
    representation_policy_id: policy.representationPolicyId,
    representation_policy_fingerprint: policy.representationPolicyFingerprint,
    representation_fingerprint: HASHES.representation, lexical_generation_id: '1000',
    lexical_generation_fingerprint: HASHES.generation, activation_revision: '1',
    activation_fingerprint: '', activated_at: ACTIVATED_AT,
  };
  const merged = { ...base, ...overrides };
  const input = {
    familyId: merged.family_id, retrievalPolicyId: merged.retrieval_policy_id,
    retrievalPolicyFingerprint: merged.retrieval_policy_fingerprint,
    status: merged.status === 'inactive' ? 'inactive' as const : 'active' as const,
    receiptId: merged.receipt_id, documentId: merged.document_id,
    familyRevision: merged.family_revision, familyFingerprint: merged.family_fingerprint,
    resolutionFingerprint: merged.resolution_fingerprint, resolverId: merged.resolver_id,
    resolverVersion: merged.resolver_version, manualControlRevision: merged.manual_control_revision,
    selectionMode: merged.selection_mode === 'none' ? 'none' as const : 'automatic' as const,
    eligibilityRevision: merged.eligibility_revision,
    eligibilityFingerprint: merged.eligibility_fingerprint,
    representationPolicyId: merged.representation_policy_id,
    representationPolicyFingerprint: merged.representation_policy_fingerprint,
    representationFingerprint: merged.representation_fingerprint,
    lexicalGenerationId: merged.lexical_generation_id,
    lexicalGenerationFingerprint: merged.lexical_generation_fingerprint,
  };
  return { ...merged, activation_fingerprint: overrides.activation_fingerprint
    ?? activationFingerprint(input) };
}

function inactiveActivation(): ProjectionActivationRow {
  return activation({
    status: 'inactive', receipt_id: null, document_id: null, selection_mode: 'none',
    eligibility_revision: null, eligibility_fingerprint: null,
    representation_policy_id: null, representation_policy_fingerprint: null,
    representation_fingerprint: null, lexical_generation_id: null,
    lexical_generation_fingerprint: null, activated_at: null,
  });
}

function document(
  id: string,
  receiptId: string,
  current = false,
  ready = false,
  activatedAt: Date | null = null,
): ProjectionDocumentRow {
  return { id, receipt_id: receiptId, is_current_effective: current,
    is_retrieval_ready: ready, activated_at: activatedAt };
}

function eligibility(overrides: Partial<ProjectionEligibilityRow> = {}): ProjectionEligibilityRow {
  const policy = getRetrievalPolicy(LEGACY_PROJECTION_RETRIEVAL_POLICY_ID);
  return {
    document_id: '100', receipt_id: '10',
    retrieval_policy_id: LEGACY_PROJECTION_RETRIEVAL_POLICY_ID,
    retrieval_policy_fingerprint: policy.fingerprint, status: 'eligible',
    eligibility_revision: '1', eligibility_fingerprint: HASHES.eligibility,
    representation_policy_id: policy.representationPolicyId,
    representation_policy_fingerprint: policy.representationPolicyFingerprint,
    representation_fingerprint: HASHES.representation, lexical_generation_id: '1000',
    lexical_generation_fingerprint: HASHES.generation, ...overrides,
  };
}

class Session implements LegacyProjectionSession {
  familyExists = true;
  activation: ProjectionActivationRow | null = activation();
  documents: ProjectionDocumentRow[] = [document('100', '10'), document('200', '20', true, true,
    new Date('2099-01-01T00:00:00.000Z'))];
  eligibility: ProjectionEligibilityRow | null = eligibility();
  updates = 0;
  updateIds: readonly string[] = [];
  lockedPolicyId: string | null = null;

  async lockFamily() { return this.familyExists; }
  async lockDesignatedActivation(_familyId: string, policyId: string) {
    this.lockedPolicyId = policyId;
    return this.activation;
  }
  async lockFamilyDocuments() { return this.documents; }
  async lockEligibility() { return this.eligibility; }
  async updateLegacyFlags(ids: readonly string[]) {
    this.updates += ids.length === 0 ? 0 : 1;
    this.updateIds = ids;
    return ids.length;
  }
}

class Store implements LegacyProjectionStore {
  transactions = 0;
  constructor(readonly session: Session) {}
  async transaction<T>(operation: (session: LegacyProjectionSession) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return operation(this.session);
  }
}

function projectionError(code: LegacyFilingProjectionError['code']) {
  return (value: unknown) => value instanceof LegacyFilingProjectionError && value.code === code;
}

test('designated policy and family-only input drive active repair projection', async () => {
  assert.equal(LEGACY_PROJECTION_RETRIEVAL_POLICY_ID, 'filing-retrieval-lexical-v1');
  const session = new Session();
  const result = await new LegacyFilingProjectionService(new Store(session))
    .reconcileLegacyFilingProjection({ familyId: '1' });
  assert.deepEqual(result, {
    familyId: '1', designatedPolicyId: LEGACY_PROJECTION_RETRIEVAL_POLICY_ID,
    activationRevision: '1', activeDocumentId: '100', updatedDocumentCount: 2,
    status: 'updated',
  });
  assert.deepEqual(session.updateIds, ['100', '200']);
  assert.equal(session.lockedPolicyId, LEGACY_PROJECTION_RETRIEVAL_POLICY_ID);
});

test('inactive and missing activation clear stale family projection', async () => {
  for (const current of [inactiveActivation(), null]) {
    const session = new Session();
    session.activation = current;
    session.documents = [document('100', '10', true, true, ACTIVATED_AT)];
    const result = await new LegacyFilingProjectionService(new Store(session))
      .reconcileLegacyFilingProjection({ familyId: '1' });
    assert.deepEqual([result.status, result.activeDocumentId, result.updatedDocumentCount],
      ['cleared', null, 1]);
  }
});

test('exact active state is a write-free no-op with activation timestamp preserved', async () => {
  const session = new Session();
  session.documents = [document('100', '10', true, true, ACTIVATED_AT), document('200', '20')];
  const result = await new LegacyFilingProjectionService(new Store(session))
    .reconcileLegacyFilingProjection({ familyId: '1' });
  assert.deepEqual([result.status, result.updatedDocumentCount, session.updates],
    ['already_current', 0, 0]);
});

test('eligible inactive representation stays false because activation is sole authority', async () => {
  const session = new Session();
  session.documents = [document('100', '10'), document('101', '10')];
  const result = await new LegacyFilingProjectionService(new Store(session))
    .reconcileLegacyFilingProjection({ familyId: '1' });
  assert.equal(result.activeDocumentId, '100');
  assert.deepEqual(session.updateIds, ['100']);
});

test('invalid input, missing family, activation corruption, ownership, and stale eligibility fail',
  async () => {
    const service = (session: Session) => new LegacyFilingProjectionService(new Store(session));
    await assert.rejects(service(new Session()).reconcileLegacyFilingProjection({ familyId: '0' }),
      projectionError('FILING_LEGACY_PROJECTION_INVALID_INPUT'));
    const missing = new Session(); missing.familyExists = false;
    await assert.rejects(service(missing).reconcileLegacyFilingProjection({ familyId: '1' }),
      projectionError('FILING_LEGACY_PROJECTION_FAMILY_NOT_FOUND'));
    const corrupt = new Session(); corrupt.activation = activation({ activation_fingerprint: '0'.repeat(64) });
    await assert.rejects(service(corrupt).reconcileLegacyFilingProjection({ familyId: '1' }),
      projectionError('FILING_LEGACY_PROJECTION_ACTIVATION_INTEGRITY_FAILURE'));
    const ownership = new Session(); ownership.documents = [document('200', '20')];
    await assert.rejects(service(ownership).reconcileLegacyFilingProjection({ familyId: '1' }),
      projectionError('FILING_LEGACY_PROJECTION_OWNERSHIP_FAILURE'));
    const stale = new Session(); stale.eligibility = eligibility({ eligibility_revision: '2' });
    await assert.rejects(service(stale).reconcileLegacyFilingProjection({ familyId: '1' }),
      projectionError('FILING_LEGACY_PROJECTION_ELIGIBILITY_STALE'));
    assert.equal(corrupt.updates + ownership.updates + stale.updates, 0);
  });
