import assert from 'node:assert/strict';
import test from 'node:test';
import { AdmissionDenied, AdmissionGuard } from '../src/filingIntelligence/admission/guard.js';
import { evidence as syntheticAdmissionEvidence } from './fixtures/admission.js';

import { activationFingerprint } from '../src/filingIntelligence/activation/fingerprints.js';
import { ActiveFilingScopeService } from '../src/filingIntelligence/activeScope/activeFilingScopeService.js';
import { ActiveScopeEvidenceRow } from '../src/filingIntelligence/activeScope/activeFilingScopeRepository.js';
import { ActiveFilingScopeError } from '../src/filingIntelligence/activeScope/errors.js';
import { activeFilingScopeFingerprint } from '../src/filingIntelligence/activeScope/fingerprints.js';
import { FILING_RETRIEVAL_POLICY } from '../src/filingIntelligence/eligibility/policies.js';
import { FILING_LEXICAL_PROFILE } from '../src/filingIntelligence/lexical/profile.js';
import { lineageFingerprint } from '../src/filingIntelligence/lineage/fingerprints.js';
import { REPRESENTATION_MANIFEST_VERSION } from '../src/filingIntelligence/persistence/representationManifest.js';

const NOW = new Date('2099-06-01T00:00:00.000Z');
const FAMILY_HASH = 'a'.repeat(64);
const RESOLUTION_HASH = 'b'.repeat(64);
const ELIGIBILITY_HASH = 'c'.repeat(64);
const REPRESENTATION_HASH = 'd'.repeat(64);
const GENERATION_HASH = 'e'.repeat(64);
const RECEIPT_HASH = 'f'.repeat(64);

function activationFor(row: ActiveScopeEvidenceRow) {
  return {
    familyId: row.family_id!,
    retrievalPolicyId: row.activation_policy_id!,
    retrievalPolicyFingerprint: row.activation_policy_fingerprint!,
    status: 'active' as const,
    receiptId: row.activation_receipt_id!,
    documentId: row.activation_document_id!,
    familyRevision: row.activation_family_revision!,
    familyFingerprint: row.activation_family_fingerprint!,
    resolutionFingerprint: row.activation_resolution_fingerprint!,
    resolverId: row.activation_resolver_id!,
    resolverVersion: row.activation_resolver_version!,
    manualControlRevision: row.activation_manual_control_revision,
    selectionMode: row.activation_selection_mode as 'automatic' | 'manual',
    eligibilityRevision: row.activation_eligibility_revision!,
    eligibilityFingerprint: row.activation_eligibility_fingerprint!,
    representationPolicyId: row.activation_representation_policy_id!,
    representationPolicyFingerprint: row.activation_representation_policy_fingerprint!,
    representationFingerprint: row.activation_representation_fingerprint!,
    lexicalGenerationId: row.activation_lexical_generation_id!,
    lexicalGenerationFingerprint: row.activation_lexical_generation_fingerprint!,
  };
}

function rowFor(
  familyId = '1',
  rootReceiptNumber = '20990601000000',
  overrides: Partial<ActiveScopeEvidenceRow> = {},
): ActiveScopeEvidenceRow {
  const receiptId = String(BigInt(familyId) * 10n);
  const documentId = String(BigInt(familyId) * 100n);
  const generationId = String(BigInt(familyId) * 1000n);
  const base: ActiveScopeEvidenceRow = {
    database_now: NOW, family_id: familyId, family_provider: 'opendart-fss',
    family_corp_code: '55555555', family_symbol: '555555',
    lineage_root_receipt_number: rootReceiptNumber,
    activation_policy_id: FILING_RETRIEVAL_POLICY.policyId,
    activation_policy_fingerprint: FILING_RETRIEVAL_POLICY.fingerprint,
    activation_status: 'active', activation_receipt_id: receiptId,
    activation_document_id: documentId, activation_family_revision: '1',
    activation_family_fingerprint: FAMILY_HASH,
    activation_resolution_fingerprint: RESOLUTION_HASH,
    activation_resolver_id: 'opendart-current-effective',
    activation_resolver_version: '1.0.0', activation_manual_control_revision: null,
    activation_selection_mode: 'automatic', activation_eligibility_revision: '1',
    activation_eligibility_fingerprint: ELIGIBILITY_HASH,
    activation_representation_policy_id: FILING_RETRIEVAL_POLICY.representationPolicyId,
    activation_representation_policy_fingerprint:
      FILING_RETRIEVAL_POLICY.representationPolicyFingerprint,
    activation_representation_fingerprint: REPRESENTATION_HASH,
    activation_lexical_generation_id: generationId,
    activation_lexical_generation_fingerprint: GENERATION_HASH,
    activation_revision: '1', activation_fingerprint: null,
    activation_activated_at: new Date('2099-05-01T00:00:00.000Z'),
    member_family_id: familyId, member_receipt_id: receiptId,
    receipt_id: receiptId, receipt_provider: 'opendart-fss',
    receipt_number: rootReceiptNumber, receipt_corp_code: '55555555',
    receipt_symbol: '555555', receipt_legal_status: 'reported_active',
    receipt_metadata_fingerprint: RECEIPT_HASH,
    document_id: documentId, document_receipt_id: receiptId,
    document_provider: 'opendart-fss', document_corp_code: '55555555',
    document_symbol: '555555', eligibility_document_id: documentId,
    eligibility_receipt_id: receiptId,
    eligibility_policy_id: FILING_RETRIEVAL_POLICY.policyId,
    eligibility_policy_fingerprint: FILING_RETRIEVAL_POLICY.fingerprint,
    eligibility_representation_policy_id: FILING_RETRIEVAL_POLICY.representationPolicyId,
    eligibility_representation_policy_fingerprint:
      FILING_RETRIEVAL_POLICY.representationPolicyFingerprint,
    eligibility_status: 'eligible',
    eligibility_representation_fingerprint: REPRESENTATION_HASH,
    eligibility_fingerprint: ELIGIBILITY_HASH,
    eligibility_lexical_generation_id: generationId,
    eligibility_lexical_profile_id: FILING_LEXICAL_PROFILE.profileId,
    eligibility_lexical_schema_version: FILING_LEXICAL_PROFILE.schemaVersion,
    eligibility_lexical_normalizer_version: FILING_LEXICAL_PROFILE.normalizerVersion,
    eligibility_lexical_text_search_config: FILING_LEXICAL_PROFILE.textSearchConfig,
    eligibility_lexical_generation_fingerprint: GENERATION_HASH,
    eligibility_lexical_chunk_count: 2, eligibility_lexical_total_lexeme_count: 20,
    eligibility_revision: '1', manifest_document_id: documentId,
    manifest_version: REPRESENTATION_MANIFEST_VERSION,
    manifest_representation_fingerprint: REPRESENTATION_HASH,
    generation_id: generationId, generation_document_id: documentId,
    generation_profile_id: FILING_LEXICAL_PROFILE.profileId,
    generation_schema_version: FILING_LEXICAL_PROFILE.schemaVersion,
    generation_normalizer_version: FILING_LEXICAL_PROFILE.normalizerVersion,
    generation_text_search_config: FILING_LEXICAL_PROFILE.textSearchConfig,
    generation_status: 'ready', generation_chunk_count: 2,
    generation_fingerprint: GENERATION_HASH, generation_total_lexeme_count: 20,
    control_mode: null, control_selected_receipt_id: null, control_reason_code: null,
    control_reference_hash: null, control_actor_reference_hash: null,
    control_expires_at: null, control_revision: null, control_fingerprint: null,
  };
  const merged = { ...base, ...overrides };
  return {
    ...merged,
    activation_fingerprint: overrides.activation_fingerprint
      ?? activationFingerprint(activationFor(merged)),
  };
}

function hold(row: ActiveScopeEvidenceRow, expiresAt: Date | null): ActiveScopeEvidenceRow {
  const referenceHash = '1'.repeat(64);
  const controlFingerprint = lineageFingerprint({
    familyId: row.family_id!, mode: 'hold', selectedReceiptId: null,
    reasonCode: 'emergency_hold', referenceHash, actorReferenceHash: null,
    expiresAt: expiresAt?.toISOString() ?? null,
  });
  return rowFor(row.family_id!, row.lineage_root_receipt_number!, {
    ...row, control_mode: 'hold', control_reason_code: 'emergency_hold',
    control_reference_hash: referenceHash, control_expires_at: expiresAt,
    control_revision: '1', control_fingerprint: controlFingerprint,
  });
}

class Loader {
  companyLoads = 0;
  constructor(readonly rows: readonly ActiveScopeEvidenceRow[]) {}
  async loadFamily() { return this.rows[0]!; }
  async loadCompany() { this.companyLoads += 1; return this.rows; }
}

function admissionGuard(deny = false) {
  return new AdmissionGuard({ async load(binding) {
    const e = syntheticAdmissionEvidence(binding);
    for (const a of e.artifacts) {
      a.source.request.startedAt = NOW.toISOString();
      a.source.response.headersObservedAt = NOW.toISOString();
      a.source.response.bodyReceivedAt = NOW.toISOString();
    }
    if (deny) e.lineage = null;
    return e;
  } }, { now: () => NOW.toISOString() });
}

test('guarded actual scope service checks both family and company before return', async () => {
  const service = ActiveFilingScopeService.guarded(new Loader([rowFor()]), admissionGuard());
  assert.equal((await service.resolveFamily({ familyId: '1', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId })).status, 'active');
  assert.equal((await service.resolveCompany({ corpCode: '55555555', symbol: '555555', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId })).status, 'active');
});

test('guarded actual scope service rejects unsupported evidence, preserves veto semantics', async () => {
  const service = ActiveFilingScopeService.guarded(new Loader([rowFor()]), admissionGuard(true));
  await assert.rejects(service.resolveFamily({ familyId: '1', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId }), AdmissionDenied);
  await assert.rejects(service.resolveCompany({ corpCode: '55555555', symbol: '555555', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId }), AdmissionDenied);
  const veto = ActiveFilingScopeService.guarded(new Loader([hold(rowFor(), null)]), admissionGuard(true));
  assert.equal((await veto.resolveFamily({ familyId: '1', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId })).status, 'vetoed');
});

test('guarded scope factory requires guard and never silently selects legacy', () => {
  assert.throws(() => ActiveFilingScopeService.guarded(new Loader([]), undefined as never), AdmissionDenied);
});

for (const kind of ['family', 'company'] as const) test(`F3 public ${kind} scope returns owned snapshot after provider mutation`, async () => {
  const row = rowFor(); const loader = new Loader([row]); let mutated = false;
  const guard = new AdmissionGuard({ async load(binding) {
    const e = syntheticAdmissionEvidence(binding);
    for (const a of e.artifacts) {
      a.source.request.startedAt = NOW.toISOString(); a.source.response.headersObservedAt = NOW.toISOString();
      a.source.response.bodyReceivedAt = NOW.toISOString();
    }
    Object.assign(row, { activation_representation_fingerprint: 'b'.repeat(64) }); mutated = true;
    return e;
  } }, { now: () => NOW.toISOString() });
  const service = ActiveFilingScopeService.guarded(loader, guard);
  const r = kind === 'family'
    ? await service.resolveFamily({ familyId: '1', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId })
    : await service.resolveCompany({ corpCode: '55555555', symbol: '555555', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId });
  assert.equal(mutated, true); const entry = 'entries' in r ? r.entries[0]! : r.entry!;
  assert.equal(entry.representationFingerprint, REPRESENTATION_HASH);
  assert.equal(Object.isFrozen(r), true); assert.equal(Object.isFrozen(entry), true);
  assert.equal(Object.isFrozen(row), false);
  Object.assign(row, { activation_eligibility_revision: '999' }); assert.equal(entry.eligibilityRevision, '1');
});

function activeScopeError(code: ActiveFilingScopeError['code']) {
  return (value: unknown) => value instanceof ActiveFilingScopeError && value.code === code;
}

test('scope fingerprint is deterministic and excludes resolved time', () => {
  const input = {
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    retrievalPolicyFingerprint: FILING_RETRIEVAL_POLICY.fingerprint,
    corpCode: '55555555', symbol: '555555', familyId: null, entries: [], vetoes: [],
  };
  assert.equal(activeFilingScopeFingerprint(input), activeFilingScopeFingerprint({ ...input }));
  assert.match(activeFilingScopeFingerprint(input), /^[0-9a-f]{64}$/);
});

test('family and company services return verified active document IDs', async () => {
  const service = new ActiveFilingScopeService(new Loader([rowFor()]));
  const family = await service.resolveFamily({
    familyId: '1', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  });
  const company = await service.resolveCompany({
    corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  });
  assert.deepEqual([family.status, family.documentIds], ['active', ['100']]);
  assert.deepEqual([company.status, company.documentIds], ['active', ['100']]);
});

test('missing activation and inactive company rows are normal empty state', async () => {
  const inactive = rowFor('1', '20990601000000', {
    activation_status: 'inactive', activation_receipt_id: null,
    activation_document_id: null,
  });
  const service = new ActiveFilingScopeService(new Loader([inactive]));
  assert.equal((await service.resolveFamily({
    familyId: '1', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  })).status, 'empty');
  const company = await service.resolveCompany({
    corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  });
  assert.deepEqual([company.status, company.documentIds], ['empty', []]);
});

test('manual hold vetoes only while active and manual selection does not veto', async () => {
  const activeHold = new ActiveFilingScopeService(new Loader([
    hold(rowFor(), new Date('2099-06-02T00:00:00.000Z')),
  ]));
  assert.equal((await activeHold.resolveFamily({
    familyId: '1', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  })).status, 'vetoed');

  const expired = new ActiveFilingScopeService(new Loader([
    hold(rowFor(), new Date('2099-05-31T00:00:00.000Z')),
  ]));
  assert.equal((await expired.resolveFamily({
    familyId: '1', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  })).status, 'active');

  const selected = rowFor('1', '20990601000000', {
    control_mode: 'select', control_selected_receipt_id: '10',
    control_reason_code: 'manual_verified_selection', control_reference_hash: '2'.repeat(64),
    control_revision: '1', control_fingerprint: lineageFingerprint({
      familyId: '1', mode: 'select', selectedReceiptId: '10',
      reasonCode: 'manual_verified_selection', referenceHash: '2'.repeat(64),
      actorReferenceHash: null, expiresAt: null,
    }),
  });
  assert.equal((await new ActiveFilingScopeService(new Loader([selected])).resolveFamily({
    familyId: '1', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  })).status, 'active');

  const changedSelection = rowFor('1', '20990601000000', {
    control_mode: 'select', control_selected_receipt_id: '999',
    control_reason_code: 'manual_verified_selection', control_reference_hash: 'invalid',
    control_revision: '999', control_fingerprint: 'invalid',
  });
  assert.equal((await new ActiveFilingScopeService(new Loader([changedSelection])).resolveFamily({
    familyId: '1', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  })).status, 'active');
});

test('company all-veto status is empty and effective veto changes the fingerprint', async () => {
  const activeRow = rowFor();
  const active = await new ActiveFilingScopeService(new Loader([activeRow])).resolveCompany({
    corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  });
  const held = await new ActiveFilingScopeService(new Loader([
    hold(activeRow, new Date('2099-06-02T00:00:00.000Z')),
  ])).resolveCompany({ corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId });
  const expired = await new ActiveFilingScopeService(new Loader([
    hold(activeRow, new Date('2099-05-31T00:00:00.000Z')),
  ])).resolveCompany({ corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId });
  assert.deepEqual([held.status, held.documentIds, held.vetoes.length], ['empty', [], 1]);
  assert.notEqual(held.scopeFingerprint, active.scopeFingerprint);
  assert.equal(expired.scopeFingerprint, active.scopeFingerprint);
});

test('withdrawn and cancelled veto while unknown remains active', async () => {
  for (const legalStatus of ['withdrawn', 'cancelled'] as const) {
    const result = await new ActiveFilingScopeService(new Loader([
      rowFor('1', '20990601000000', { receipt_legal_status: legalStatus }),
    ])).resolveFamily({ familyId: '1', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId });
    assert.deepEqual([result.status, result.veto?.reason], [
      'vetoed', legalStatus === 'withdrawn' ? 'receipt_withdrawn' : 'receipt_cancelled',
    ]);
  }
  const unknown = await new ActiveFilingScopeService(new Loader([
    rowFor('1', '20990601000000', { receipt_legal_status: 'unknown' }),
  ])).resolveFamily({ familyId: '1', retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId });
  assert.equal(unknown.status, 'active');
});

test('company ordering is deterministic and integrity corruption fails the whole scope', async () => {
  const rows = [rowFor('2', '20990602000000'), rowFor('1', '20990601000000')];
  const first = await new ActiveFilingScopeService(new Loader(rows)).resolveCompany({
    corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  });
  const second = await new ActiveFilingScopeService(new Loader([...rows].reverse())).resolveCompany({
    corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  });
  assert.deepEqual(first.documentIds, ['100', '200']);
  assert.equal(first.scopeFingerprint, second.scopeFingerprint);

  await assert.rejects(new ActiveFilingScopeService(new Loader([
    rows[0]!, rowFor('1', '20990601000000', { eligibility_status: 'ineligible' }),
  ])).resolveCompany({ corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId }),
  activeScopeError('FILING_ACTIVE_SCOPE_ELIGIBILITY_STALE'));
});

test('company resolution uses one repository statement independent of family count', async () => {
  for (const count of [0, 1, 10, 20]) {
    const rows = count === 0
      ? [rowFor('1', '20990601000000', { activation_status: 'inactive' })]
      : Array.from({ length: count }, (_, index) => rowFor(
        String(index + 1), `209906${String(index + 1).padStart(8, '0')}`,
      ));
    const loader = new Loader(rows);
    await new ActiveFilingScopeService(loader).resolveCompany({
      corpCode: '55555555', symbol: '555555',
      retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    });
    assert.equal(loader.companyLoads, 1);
  }
});

test('every missing joined evidence class fails closed instead of becoming empty', async () => {
  const cases: readonly [Partial<ActiveScopeEvidenceRow>, ActiveFilingScopeError['code']][] = [
    [{ member_family_id: null }, 'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE'],
    [{ receipt_id: null }, 'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE'],
    [{ document_id: null }, 'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE'],
    [{ eligibility_document_id: null }, 'FILING_ACTIVE_SCOPE_ELIGIBILITY_STALE'],
    [{ manifest_document_id: null }, 'FILING_ACTIVE_SCOPE_REPRESENTATION_INTEGRITY_FAILURE'],
    [{ generation_id: null }, 'FILING_ACTIVE_SCOPE_ELIGIBILITY_STALE'],
  ];
  for (const [override, code] of cases) {
    await assert.rejects(new ActiveFilingScopeService(new Loader([
      rowFor('1', '20990601000000', override),
    ])).resolveCompany({ corpCode: '55555555', symbol: '555555',
      retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId }), activeScopeError(code));
  }
});

test('policy drift, activation corruption, and scope overflow fail closed', async () => {
  await assert.rejects(new ActiveFilingScopeService(new Loader([
    rowFor('1', '20990601000000', {
      activation_policy_fingerprint: '9'.repeat(64),
      eligibility_policy_fingerprint: '9'.repeat(64),
    }),
  ])).resolveCompany({ corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId }),
  activeScopeError('FILING_ACTIVE_SCOPE_POLICY_DRIFT'));
  await assert.rejects(new ActiveFilingScopeService(new Loader([
    rowFor('1', '20990601000000', { activation_fingerprint: '0'.repeat(64) }),
  ])).resolveCompany({ corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId }),
  activeScopeError('FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE'));
  await assert.rejects(new ActiveFilingScopeService(new Loader([
    rowFor('1', '20990601000000', { manifest_document_id: null }),
  ])).resolveCompany({ corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId }),
  activeScopeError('FILING_ACTIVE_SCOPE_REPRESENTATION_INTEGRITY_FAILURE'));
  await assert.rejects(new ActiveFilingScopeService(new Loader([
    rowFor('1', '20990601000000', {
      manifest_representation_fingerprint: '8'.repeat(64),
    }),
  ])).resolveCompany({ corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId }),
  activeScopeError('FILING_ACTIVE_SCOPE_REPRESENTATION_INTEGRITY_FAILURE'));
  const overflow = Array.from({ length: 21 }, (_, index) => rowFor(
    String(index + 1), `209907${String(index + 1).padStart(8, '0')}`,
  ));
  await assert.rejects(new ActiveFilingScopeService(new Loader(overflow)).resolveCompany({
    corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  }), activeScopeError('FILING_ACTIVE_SCOPE_TOO_LARGE'));
  await assert.rejects(new ActiveFilingScopeService(new Loader(
    overflow.map(row => hold(row, new Date('2099-08-01T00:00:00.000Z'))),
  )).resolveCompany({
    corpCode: '55555555', symbol: '555555',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  }), activeScopeError('FILING_ACTIVE_SCOPE_TOO_LARGE'));
});
