import { activationFingerprint } from '../activation/fingerprints.js';
import { ActivationFingerprintInput } from '../activation/contracts.js';
import { FilingEligibilityError } from '../eligibility/errors.js';
import {
  FILING_REPRESENTATION_POLICY,
  FILING_RETRIEVAL_POLICY_V2,
  getRetrievalPolicy,
} from '../eligibility/policies.js';
import { matchRepresentation } from '../eligibility/representationAdmission.js';
import { calculateEligibilityFingerprintV2 } from '../eligibility/fingerprints.js';
import { FILING_LEXICAL_PROFILE } from '../lexical/profile.js';
import { lineageFingerprint } from '../lineage/fingerprints.js';
import { REPRESENTATION_MANIFEST_VERSION } from '../persistence/representationManifest.js';
import {
  RESOLUTION_REASON_CODES,
} from '../resolution/contracts.js';
import {
  ACTIVE_FILING_SCOPE_ID,
  ACTIVE_FILING_SCOPE_MAX_ENTRIES,
  ACTIVE_FILING_SCOPE_VERSION,
  ActiveCompanyFilingScope,
  ActiveFamilyFilingScope,
  ActiveFilingScopeEntry,
  ActiveFilingScopeVeto,
  ResolveActiveCompanyFilingScopeInput,
  ResolveActiveFamilyFilingScopeInput,
} from './contracts.js';
import { ActiveFilingScopeError, ActiveFilingScopeErrorCode } from './errors.js';
import { activeFilingScopeFingerprint } from './fingerprints.js';
import {
  ActiveFilingScopeRepository,
  ActiveScopeEvidenceRow,
} from './activeFilingScopeRepository.js';

const BIGINT = /^[1-9]\d{0,18}$/;
const CORP_CODE = /^\d{8}$/;
const SYMBOL = /^\d{6}$/;
const RECEIPT_NUMBER = /^\d{14}$/;
const HASH = /^[0-9a-f]{64}$/;

interface EvidenceLoader {
  loadFamily(familyId: string, retrievalPolicyId: string): Promise<ActiveScopeEvidenceRow>;
  loadCompany(
    corpCode: string,
    symbol: string,
    retrievalPolicyId: string,
  ): Promise<readonly ActiveScopeEvidenceRow[]>;
}

function scopeError(code: ActiveFilingScopeErrorCode, cause?: unknown): ActiveFilingScopeError {
  return new ActiveFilingScopeError(code, false, cause == null ? undefined : { cause });
}

function postgresCode(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null && 'code' in value
    && typeof value.code === 'string' ? value.code : undefined;
}

function mapError(value: unknown): ActiveFilingScopeError {
  if (value instanceof ActiveFilingScopeError) return value;
  if (value instanceof FilingEligibilityError
    && value.code === 'FILING_ELIGIBILITY_POLICY_UNKNOWN') {
    return scopeError('FILING_ACTIVE_SCOPE_POLICY_UNKNOWN');
  }
  const code = postgresCode(value);
  return new ActiveFilingScopeError(
    'FILING_ACTIVE_SCOPE_TRANSACTION_FAILURE',
    code == null || code.startsWith('08') || code === '40001'
      || code === '40P01' || code === '57014',
  );
}

function required(value: string | null, code: ActiveFilingScopeErrorCode): string {
  if (value == null || value.length === 0) throw scopeError(code);
  return value;
}

function hash(value: string | null, code: ActiveFilingScopeErrorCode): string {
  if (value == null || !HASH.test(value)) throw scopeError(code);
  return value;
}

function id(value: string | null, code: ActiveFilingScopeErrorCode): string {
  if (value == null || !BIGINT.test(value)) throw scopeError(code);
  return value;
}

function databaseNow(rows: readonly ActiveScopeEvidenceRow[]): Date {
  const first = rows[0]?.database_now;
  if (!(first instanceof Date)
    || rows.some(row => !(row.database_now instanceof Date)
      || row.database_now.getTime() !== first.getTime())) {
    throw scopeError('FILING_ACTIVE_SCOPE_TRANSACTION_FAILURE');
  }
  return first;
}

function validateControl(row: ActiveScopeEvidenceRow): void {
  if (row.control_mode !== 'hold') return;
  if (row.control_reason_code == null || !RESOLUTION_REASON_CODES.includes(
    row.control_reason_code as typeof RESOLUTION_REASON_CODES[number],
  )) throw scopeError('FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE');
  const revision = id(row.control_revision, 'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE');
  const fingerprint = hash(
    row.control_fingerprint,
    'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE',
  );
  const referenceHash = hash(
    row.control_reference_hash,
    'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE',
  );
  if (row.control_actor_reference_hash != null && !HASH.test(row.control_actor_reference_hash)) {
    throw scopeError('FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE');
  }
  if (row.control_expires_at != null && !(row.control_expires_at instanceof Date)) {
    throw scopeError('FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE');
  }
  if (row.control_selected_receipt_id != null) {
    throw scopeError('FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE');
  }
  const expected = lineageFingerprint({
    familyId: id(row.family_id, 'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE'),
    mode: row.control_mode,
    selectedReceiptId: row.control_selected_receipt_id,
    reasonCode: row.control_reason_code,
    referenceHash,
    actorReferenceHash: row.control_actor_reference_hash,
    expiresAt: row.control_expires_at?.toISOString() ?? null,
  });
  if (expected !== fingerprint || !BIGINT.test(revision)) {
    throw scopeError('FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE');
  }
}

function activationInput(row: ActiveScopeEvidenceRow): ActivationFingerprintInput {
  const status = row.activation_status;
  const selectionMode = row.activation_selection_mode;
  if (status !== 'active' || (selectionMode !== 'automatic' && selectionMode !== 'manual')) {
    throw scopeError('FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE');
  }
  return {
    familyId: id(row.family_id, 'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE'),
    retrievalPolicyId: required(
      row.activation_policy_id,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    retrievalPolicyFingerprint: hash(
      row.activation_policy_fingerprint,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    status,
    receiptId: id(
      row.activation_receipt_id,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    documentId: id(
      row.activation_document_id,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    familyRevision: id(
      row.activation_family_revision,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    familyFingerprint: hash(
      row.activation_family_fingerprint,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    resolutionFingerprint: hash(
      row.activation_resolution_fingerprint,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    resolverId: required(
      row.activation_resolver_id,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    resolverVersion: required(
      row.activation_resolver_version,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    manualControlRevision: row.activation_manual_control_revision,
    selectionMode,
    eligibilityRevision: id(
      row.activation_eligibility_revision,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    eligibilityFingerprint: hash(
      row.activation_eligibility_fingerprint,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    representationPolicyId: required(
      row.activation_representation_policy_id,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    representationPolicyFingerprint: hash(
      row.activation_representation_policy_fingerprint,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    representationFingerprint: hash(
      row.activation_representation_fingerprint,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    lexicalGenerationId: id(
      row.activation_lexical_generation_id,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
    lexicalGenerationFingerprint: hash(
      row.activation_lexical_generation_fingerprint,
      'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
    ),
  };
}

function activeEvidence(
  row: ActiveScopeEvidenceRow,
  expectedCompany: { readonly corpCode: string; readonly symbol: string },
  policy: ReturnType<typeof getRetrievalPolicy>,
  now: Date,
): { readonly entry: ActiveFilingScopeEntry; readonly veto: ActiveFilingScopeVeto | null } {
  const activation = activationInput(row);
  const storedActivationFingerprint = hash(
    row.activation_fingerprint,
    'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
  );
  if (activationFingerprint(activation) !== storedActivationFingerprint) {
    throw scopeError('FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE');
  }
  if (activation.retrievalPolicyId !== policy.policyId
    || activation.retrievalPolicyFingerprint !== policy.fingerprint) {
    throw scopeError('FILING_ACTIVE_SCOPE_POLICY_DRIFT');
  }

  const familyId = activation.familyId;
  const receiptId = activation.receiptId!;
  const documentId = activation.documentId!;
  const familyProvider = required(row.family_provider, 'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE');
  const familyCorpCode = required(row.family_corp_code, 'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE');
  const familySymbol = required(row.family_symbol, 'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE');
  const rootReceiptNumber = required(
    row.lineage_root_receipt_number,
    'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE',
  );
  const receiptNumber = required(row.receipt_number, 'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE');
  if (familyProvider !== 'opendart-fss' || familyCorpCode !== expectedCompany.corpCode
    || familySymbol !== expectedCompany.symbol || !RECEIPT_NUMBER.test(rootReceiptNumber)
    || row.member_family_id !== familyId || row.member_receipt_id !== receiptId
    || row.receipt_id !== receiptId || row.receipt_provider !== familyProvider
    || row.receipt_corp_code !== familyCorpCode || row.receipt_symbol !== familySymbol
    || !RECEIPT_NUMBER.test(receiptNumber) || row.document_id !== documentId
    || row.document_receipt_id !== receiptId || row.document_provider !== familyProvider
    || row.document_corp_code !== familyCorpCode || row.document_symbol !== familySymbol) {
    throw scopeError('FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE');
  }

  if (row.eligibility_document_id !== documentId || row.eligibility_receipt_id !== receiptId
    || row.eligibility_policy_id !== policy.policyId || row.eligibility_status !== 'eligible'
    || row.eligibility_revision !== activation.eligibilityRevision
    || row.eligibility_fingerprint !== activation.eligibilityFingerprint) {
    throw scopeError('FILING_ACTIVE_SCOPE_ELIGIBILITY_STALE');
  }
  let matched = FILING_REPRESENTATION_POLICY as ReturnType<typeof matchRepresentation>;
  if (policy === FILING_RETRIEVAL_POLICY_V2) {
    try {
      const document = row.admission_document;
      const generation = row.admission_generation;
      if (!document || !generation || document.id !== documentId
        || row.admission_computed_fingerprint !== document.representation_fingerprint
        || document.receipt_id !== receiptId || document.provider !== familyProvider
        || document.receipt_number !== receiptNumber) {
        throw scopeError('FILING_ACTIVE_SCOPE_REPRESENTATION_INTEGRITY_FAILURE');
      }
      matched = matchRepresentation(document, policy);
      if (!matched || calculateEligibilityFingerprintV2(document, matched, {
        status: 'eligible', reasonCode: 'eligible', generation,
      }) !== row.eligibility_fingerprint) {
        throw scopeError('FILING_ACTIVE_SCOPE_REPRESENTATION_INTEGRITY_FAILURE');
      }
    } catch {
      throw scopeError('FILING_ACTIVE_SCOPE_REPRESENTATION_INTEGRITY_FAILURE');
    }
  }
  if (row.eligibility_policy_fingerprint !== policy.fingerprint
    || row.eligibility_representation_policy_id !== matched!.policyId
    || row.eligibility_representation_policy_fingerprint
      !== matched!.fingerprint
    || activation.representationPolicyId !== matched!.policyId
    || activation.representationPolicyFingerprint !== matched!.fingerprint) {
    throw scopeError('FILING_ACTIVE_SCOPE_POLICY_DRIFT');
  }
  if (row.manifest_document_id !== documentId
    || row.manifest_version !== REPRESENTATION_MANIFEST_VERSION
    || row.manifest_representation_fingerprint !== activation.representationFingerprint
    || row.eligibility_representation_fingerprint !== activation.representationFingerprint) {
    throw scopeError('FILING_ACTIVE_SCOPE_REPRESENTATION_INTEGRITY_FAILURE');
  }

  if (row.generation_id !== activation.lexicalGenerationId
    || row.generation_document_id !== documentId
    || row.eligibility_lexical_generation_id !== activation.lexicalGenerationId
    || row.generation_profile_id !== policy.lexicalProfileId
    || row.eligibility_lexical_profile_id !== policy.lexicalProfileId
    || row.generation_profile_id !== FILING_LEXICAL_PROFILE.profileId
    || row.generation_schema_version !== row.eligibility_lexical_schema_version
    || row.generation_normalizer_version !== row.eligibility_lexical_normalizer_version
    || row.generation_text_search_config !== row.eligibility_lexical_text_search_config
    || row.generation_status !== 'ready'
    || row.generation_chunk_count !== row.eligibility_lexical_chunk_count
    || row.generation_total_lexeme_count !== row.eligibility_lexical_total_lexeme_count
    || row.generation_fingerprint !== activation.lexicalGenerationFingerprint
    || row.eligibility_lexical_generation_fingerprint
      !== activation.lexicalGenerationFingerprint) {
    throw scopeError('FILING_ACTIVE_SCOPE_ELIGIBILITY_STALE');
  }
  validateControl(row);

  const activatedAt = row.activation_activated_at;
  const selectionMode = activation.selectionMode;
  if (!(activatedAt instanceof Date) || !id(
    row.activation_revision,
    'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE',
  ) || (selectionMode !== 'automatic' && selectionMode !== 'manual')) {
    throw scopeError('FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE');
  }
  const entry: ActiveFilingScopeEntry = {
    familyId,
    lineageRootReceiptNumber: rootReceiptNumber,
    receiptId,
    receiptNumber,
    documentId,
    activationRevision: row.activation_revision!,
    activationFingerprint: storedActivationFingerprint,
    eligibilityRevision: activation.eligibilityRevision!,
    eligibilityFingerprint: activation.eligibilityFingerprint!,
    representationFingerprint: activation.representationFingerprint!,
    lexicalGenerationId: activation.lexicalGenerationId!,
    lexicalGenerationFingerprint: activation.lexicalGenerationFingerprint!,
    activatedAt: activatedAt.toISOString(),
    selectionMode,
  };

  if (row.control_mode === 'hold'
    && (row.control_expires_at == null || row.control_expires_at > now)) {
    return { entry, veto: {
      familyId, lineageRootReceiptNumber: rootReceiptNumber, reason: 'manual_hold',
      evidenceRevision: row.control_revision,
      evidenceFingerprint: row.control_fingerprint!,
    } };
  }
  if (row.receipt_legal_status === 'withdrawn'
    || row.receipt_legal_status === 'cancelled') {
    return { entry, veto: {
      familyId, lineageRootReceiptNumber: rootReceiptNumber,
      reason: row.receipt_legal_status === 'withdrawn'
        ? 'receipt_withdrawn' : 'receipt_cancelled',
      evidenceRevision: null,
      evidenceFingerprint: hash(
        row.receipt_metadata_fingerprint,
        'FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE',
      ),
    } };
  }
  if (row.receipt_legal_status !== 'reported_active' && row.receipt_legal_status !== 'unknown') {
    throw scopeError('FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE');
  }
  return { entry, veto: null };
}

function compareEntries(left: ActiveFilingScopeEntry, right: ActiveFilingScopeEntry): number {
  return left.lineageRootReceiptNumber.localeCompare(right.lineageRootReceiptNumber)
    || (BigInt(left.familyId) < BigInt(right.familyId) ? -1
      : BigInt(left.familyId) > BigInt(right.familyId) ? 1 : 0)
    || left.receiptNumber.localeCompare(right.receiptNumber)
    || (BigInt(left.documentId) < BigInt(right.documentId) ? -1
      : BigInt(left.documentId) > BigInt(right.documentId) ? 1 : 0);
}

export class ActiveFilingScopeService {
  constructor(private readonly repository: EvidenceLoader | ActiveFilingScopeRepository) {}

  async resolveFamily(
    input: ResolveActiveFamilyFilingScopeInput,
  ): Promise<ActiveFamilyFilingScope> {
    if (!BIGINT.test(input.familyId)) throw scopeError('FILING_ACTIVE_SCOPE_INVALID_INPUT');
    let policy: ReturnType<typeof getRetrievalPolicy>;
    try {
      policy = getRetrievalPolicy(input.retrievalPolicyId);
      const row = await this.repository.loadFamily(input.familyId, policy.policyId);
      const now = databaseNow([row]);
      if (row.family_id == null || row.family_id !== input.familyId
        || row.family_corp_code == null || row.family_symbol == null) {
        throw scopeError('FILING_ACTIVE_SCOPE_INVALID_INPUT');
      }
      const common = {
        scopeId: ACTIVE_FILING_SCOPE_ID,
        scopeVersion: ACTIVE_FILING_SCOPE_VERSION,
        retrievalPolicyId: policy.policyId,
        retrievalPolicyFingerprint: policy.fingerprint,
        corpCode: row.family_corp_code,
        symbol: row.family_symbol,
        familyId: input.familyId,
        resolvedAt: now.toISOString(),
      } as const;
      if (row.activation_status == null || row.activation_status === 'inactive') {
        const scopeFingerprint = activeFilingScopeFingerprint({
          ...common, entries: [], vetoes: [],
        });
        return {
          ...common, status: 'empty', entry: null, veto: null,
          documentIds: [], scopeFingerprint,
        };
      }
      const evidence = activeEvidence(row, common, policy, now);
      const entries = evidence.veto == null ? [evidence.entry] : [];
      const vetoes = evidence.veto == null ? [] : [evidence.veto];
      const scopeFingerprint = activeFilingScopeFingerprint({
        ...common, entries, vetoes,
      });
      return evidence.veto == null
        ? { ...common, status: 'active', entry: evidence.entry, veto: null,
          documentIds: [evidence.entry.documentId], scopeFingerprint }
        : { ...common, status: 'vetoed', entry: null, veto: evidence.veto,
          documentIds: [], scopeFingerprint };
    } catch (cause) {
      throw mapError(cause);
    }
  }

  async resolveCompany(
    input: ResolveActiveCompanyFilingScopeInput,
  ): Promise<ActiveCompanyFilingScope> {
    if (!CORP_CODE.test(input.corpCode) || !SYMBOL.test(input.symbol)) {
      throw scopeError('FILING_ACTIVE_SCOPE_INVALID_INPUT');
    }
    let policy: ReturnType<typeof getRetrievalPolicy>;
    try {
      policy = getRetrievalPolicy(input.retrievalPolicyId);
      const rows = await this.repository.loadCompany(
        input.corpCode, input.symbol, policy.policyId,
      );
      const now = databaseNow(rows);
      const candidates = rows.filter(row => row.family_id != null
        && row.activation_status === 'active');
      if (candidates.length > ACTIVE_FILING_SCOPE_MAX_ENTRIES) {
        throw scopeError('FILING_ACTIVE_SCOPE_TOO_LARGE');
      }
      const entries: ActiveFilingScopeEntry[] = [];
      const vetoes: ActiveFilingScopeVeto[] = [];
      for (const row of candidates) {
        const evidence = activeEvidence(row, input, policy, now);
        if (evidence.veto == null) entries.push(evidence.entry);
        else vetoes.push(evidence.veto);
      }
      entries.sort(compareEntries);
      vetoes.sort((left, right) => left.lineageRootReceiptNumber.localeCompare(
        right.lineageRootReceiptNumber,
      ) || (BigInt(left.familyId) < BigInt(right.familyId) ? -1
        : BigInt(left.familyId) > BigInt(right.familyId) ? 1 : 0));
      const fingerprintInput = {
        retrievalPolicyId: policy.policyId,
        retrievalPolicyFingerprint: policy.fingerprint,
        corpCode: input.corpCode,
        symbol: input.symbol,
        familyId: null,
        entries,
        vetoes,
      };
      return {
        scopeId: ACTIVE_FILING_SCOPE_ID,
        scopeVersion: ACTIVE_FILING_SCOPE_VERSION,
        retrievalPolicyId: policy.policyId,
        retrievalPolicyFingerprint: policy.fingerprint,
        corpCode: input.corpCode,
        symbol: input.symbol,
        status: entries.length === 0 ? 'empty' : 'active',
        entries,
        vetoes,
        documentIds: entries.map(entry => entry.documentId),
        resolvedAt: now.toISOString(),
        scopeFingerprint: activeFilingScopeFingerprint(fingerprintInput),
      };
    } catch (cause) {
      throw mapError(cause);
    }
  }
}
