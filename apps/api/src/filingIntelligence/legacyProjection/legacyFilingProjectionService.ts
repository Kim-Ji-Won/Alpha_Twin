import { ActivationFingerprintInput } from '../activation/contracts.js';
import { activationFingerprint } from '../activation/fingerprints.js';
import { getRetrievalPolicy } from '../eligibility/policies.js';
import {
  LEGACY_PROJECTION_RETRIEVAL_POLICY_ID,
  LegacyFilingProjectionResult,
  ReconcileLegacyFilingProjectionInput,
} from './contracts.js';
import {
  LegacyFilingProjectionError,
  LegacyFilingProjectionErrorCode,
} from './errors.js';
import {
  LegacyProjectionSession,
  LegacyProjectionStore,
  ProjectionActivationRow,
} from './legacyFilingProjectionRepository.js';

const BIGINT = /^[1-9]\d{0,18}$/;
const HASH = /^[0-9a-f]{64}$/;

function error(code: LegacyFilingProjectionErrorCode): LegacyFilingProjectionError {
  return new LegacyFilingProjectionError(code, false);
}

function postgresCode(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null && 'code' in value
    && typeof value.code === 'string' ? value.code : undefined;
}

function mapError(value: unknown): LegacyFilingProjectionError {
  if (value instanceof LegacyFilingProjectionError) return value;
  const code = postgresCode(value);
  return new LegacyFilingProjectionError(
    'FILING_LEGACY_PROJECTION_TRANSACTION_FAILURE',
    code?.startsWith('08') === true || code === '40001' || code === '40P01' || code === '57014',
  );
}

function id(value: string | null): string {
  if (value == null || !BIGINT.test(value)) {
    throw error('FILING_LEGACY_PROJECTION_ACTIVATION_INTEGRITY_FAILURE');
  }
  return value;
}

function hash(value: string | null): string {
  if (value == null || !HASH.test(value)) {
    throw error('FILING_LEGACY_PROJECTION_ACTIVATION_INTEGRITY_FAILURE');
  }
  return value;
}

function activationInput(row: ProjectionActivationRow): ActivationFingerprintInput {
  if ((row.status !== 'active' && row.status !== 'inactive')
    || (row.selection_mode !== 'automatic' && row.selection_mode !== 'manual'
      && row.selection_mode !== 'none')) {
    throw error('FILING_LEGACY_PROJECTION_ACTIVATION_INTEGRITY_FAILURE');
  }
  return {
    familyId: id(row.family_id),
    retrievalPolicyId: row.retrieval_policy_id,
    retrievalPolicyFingerprint: hash(row.retrieval_policy_fingerprint),
    status: row.status,
    receiptId: row.receipt_id,
    documentId: row.document_id,
    familyRevision: id(row.family_revision),
    familyFingerprint: hash(row.family_fingerprint),
    resolutionFingerprint: hash(row.resolution_fingerprint),
    resolverId: row.resolver_id,
    resolverVersion: row.resolver_version,
    manualControlRevision: row.manual_control_revision,
    selectionMode: row.selection_mode,
    eligibilityRevision: row.eligibility_revision,
    eligibilityFingerprint: row.eligibility_fingerprint,
    representationPolicyId: row.representation_policy_id,
    representationPolicyFingerprint: row.representation_policy_fingerprint,
    representationFingerprint: row.representation_fingerprint,
    lexicalGenerationId: row.lexical_generation_id,
    lexicalGenerationFingerprint: row.lexical_generation_fingerprint,
  };
}

function verifyActivation(row: ProjectionActivationRow, familyId: string): ActivationFingerprintInput {
  const input = activationInput(row);
  const policy = getRetrievalPolicy(LEGACY_PROJECTION_RETRIEVAL_POLICY_ID);
  if (input.familyId !== familyId
    || input.retrievalPolicyId !== LEGACY_PROJECTION_RETRIEVAL_POLICY_ID
    || input.retrievalPolicyFingerprint !== policy.fingerprint
    || activationFingerprint(input) !== hash(row.activation_fingerprint)
    || !BIGINT.test(row.activation_revision)) {
    throw error('FILING_LEGACY_PROJECTION_ACTIVATION_INTEGRITY_FAILURE');
  }
  const active = input.status === 'active';
  const complete = input.receiptId != null && input.documentId != null
    && input.eligibilityRevision != null && input.eligibilityFingerprint != null
    && input.representationPolicyId != null && input.representationPolicyFingerprint != null
    && input.representationFingerprint != null && input.lexicalGenerationId != null
    && input.lexicalGenerationFingerprint != null && row.activated_at instanceof Date
    && (input.selectionMode === 'automatic' || input.selectionMode === 'manual');
  const inactive = input.receiptId == null && input.documentId == null
    && input.eligibilityRevision == null && input.eligibilityFingerprint == null
    && input.representationPolicyId == null && input.representationPolicyFingerprint == null
    && input.representationFingerprint == null && input.lexicalGenerationId == null
    && input.lexicalGenerationFingerprint == null && row.activated_at == null
    && input.selectionMode === 'none';
  if ((active && !complete) || (!active && !inactive)) {
    throw error('FILING_LEGACY_PROJECTION_ACTIVATION_INTEGRITY_FAILURE');
  }
  return input;
}

function sameTime(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

async function reconcile(
  session: LegacyProjectionSession,
  familyId: string,
): Promise<LegacyFilingProjectionResult> {
  if (!await session.lockFamily(familyId)) {
    throw error('FILING_LEGACY_PROJECTION_FAMILY_NOT_FOUND');
  }
  const activation = await session.lockDesignatedActivation(
    familyId,
    LEGACY_PROJECTION_RETRIEVAL_POLICY_ID,
  );
  const documents = await session.lockFamilyDocuments(familyId);
  const verified = activation == null ? null : verifyActivation(activation, familyId);
  const activeDocumentId = verified?.status === 'active' ? id(verified.documentId) : null;
  const activeReceiptId = verified?.status === 'active' ? id(verified.receiptId) : null;
  const activatedAt = activeDocumentId == null ? null : activation!.activated_at;
  if (activeDocumentId != null) {
    const activeDocument = documents.find(document => document.id === activeDocumentId);
    if (activeDocument == null || activeDocument.receipt_id !== activeReceiptId) {
      throw error('FILING_LEGACY_PROJECTION_OWNERSHIP_FAILURE');
    }
    const eligibility = await session.lockEligibility(
      activeDocumentId,
      LEGACY_PROJECTION_RETRIEVAL_POLICY_ID,
    );
    if (eligibility == null || eligibility.document_id !== activeDocumentId
      || eligibility.receipt_id !== activeReceiptId
      || eligibility.retrieval_policy_id !== LEGACY_PROJECTION_RETRIEVAL_POLICY_ID
      || eligibility.retrieval_policy_fingerprint !== verified!.retrievalPolicyFingerprint
      || eligibility.status !== 'eligible'
      || eligibility.eligibility_revision !== verified!.eligibilityRevision
      || eligibility.eligibility_fingerprint !== verified!.eligibilityFingerprint
      || eligibility.representation_policy_id !== verified!.representationPolicyId
      || eligibility.representation_policy_fingerprint
        !== verified!.representationPolicyFingerprint
      || eligibility.representation_fingerprint !== verified!.representationFingerprint
      || eligibility.lexical_generation_id !== verified!.lexicalGenerationId
      || eligibility.lexical_generation_fingerprint !== verified!.lexicalGenerationFingerprint) {
      throw error('FILING_LEGACY_PROJECTION_ELIGIBILITY_STALE');
    }
  }
  const changed = documents.filter(document => {
    const expected = document.id === activeDocumentId;
    return document.is_current_effective !== expected
      || document.is_retrieval_ready !== expected
      || !sameTime(document.activated_at, expected ? activatedAt : null);
  });
  const updatedDocumentCount = await session.updateLegacyFlags(
    changed.map(document => document.id),
    activeDocumentId,
    activatedAt,
  );
  if (updatedDocumentCount !== changed.length) {
    throw error('FILING_LEGACY_PROJECTION_TRANSACTION_FAILURE');
  }
  const common = {
    familyId,
    designatedPolicyId: LEGACY_PROJECTION_RETRIEVAL_POLICY_ID,
    activationRevision: activation?.activation_revision ?? null,
    activeDocumentId,
    updatedDocumentCount,
  } as const;
  if (changed.length === 0) return { ...common, status: 'already_current' };
  return { ...common, status: activeDocumentId == null ? 'cleared' : 'updated' };
}

export class LegacyFilingProjectionService {
  constructor(private readonly repository: LegacyProjectionStore) {}

  async reconcileLegacyFilingProjection(
    input: ReconcileLegacyFilingProjectionInput,
  ): Promise<LegacyFilingProjectionResult> {
    if (!BIGINT.test(input.familyId)) {
      throw error('FILING_LEGACY_PROJECTION_INVALID_INPUT');
    }
    try {
      return await this.repository.transaction(session => reconcile(session, input.familyId));
    } catch (cause) {
      throw mapError(cause);
    }
  }
}
