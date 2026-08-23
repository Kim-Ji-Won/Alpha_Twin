import { Pool, PoolClient } from 'pg';

import { withTransaction } from '../../infrastructure/database/transaction.js';
import {
  ACTIVATION_EVENTS,
  ACTIVATION_REASONS,
  ACTIVATION_STATUSES,
  FilingRetrievalActivationEvent,
  FilingRetrievalActivationReason,
  FilingRetrievalActivationState,
} from './contracts.js';
import { FilingRetrievalActivationError } from './errors.js';

type ActivationRow = {
  family_id: string; retrieval_policy_id: string; retrieval_policy_fingerprint: string;
  status: string; receipt_id: string | null; document_id: string | null;
  family_revision: string; family_fingerprint: string; resolution_fingerprint: string;
  resolver_id: string; resolver_version: string; manual_control_revision: string | null;
  selection_mode: string; eligibility_revision: string | null;
  eligibility_fingerprint: string | null; representation_policy_id: string | null;
  representation_policy_fingerprint: string | null; representation_fingerprint: string | null;
  lexical_generation_id: string | null; lexical_generation_fingerprint: string | null;
  activation_revision: string; activation_fingerprint: string; activated_at: Date | null;
  state_changed_at: Date; created_at: Date; updated_at: Date;
};

const ACTIVATION_COLUMNS = `family_id::text, retrieval_policy_id,
  retrieval_policy_fingerprint, status, receipt_id::text, document_id::text,
  family_revision::text, family_fingerprint, resolution_fingerprint, resolver_id,
  resolver_version, manual_control_revision::text, selection_mode,
  eligibility_revision::text, eligibility_fingerprint, representation_policy_id,
  representation_policy_fingerprint, representation_fingerprint,
  lexical_generation_id::text, lexical_generation_fingerprint,
  activation_revision::text, activation_fingerprint, activated_at,
  state_changed_at, created_at, updated_at`;

function includes<T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value);
}

function integrity(): never {
  throw new FilingRetrievalActivationError('FILING_ACTIVATION_INTEGRITY_FAILURE', false);
}

function mapRow(row: ActivationRow): FilingRetrievalActivationState {
  if (!includes(ACTIVATION_STATUSES, row.status)
    || !['automatic', 'manual', 'none'].includes(row.selection_mode)
    || !(row.state_changed_at instanceof Date) || !(row.created_at instanceof Date)
    || !(row.updated_at instanceof Date)) return integrity();
  const active = row.status === 'active';
  if (active !== (row.receipt_id != null && row.document_id != null
    && row.eligibility_revision != null && row.eligibility_fingerprint != null
    && row.representation_policy_id != null && row.representation_policy_fingerprint != null
    && row.representation_fingerprint != null && row.lexical_generation_id != null
    && row.lexical_generation_fingerprint != null && row.activated_at instanceof Date)) {
    return integrity();
  }
  return {
    familyId: row.family_id,
    retrievalPolicyId: row.retrieval_policy_id,
    retrievalPolicyFingerprint: row.retrieval_policy_fingerprint,
    status: row.status,
    receiptId: row.receipt_id,
    documentId: row.document_id,
    familyRevision: row.family_revision,
    familyFingerprint: row.family_fingerprint,
    resolutionFingerprint: row.resolution_fingerprint,
    resolverId: row.resolver_id,
    resolverVersion: row.resolver_version,
    manualControlRevision: row.manual_control_revision,
    selectionMode: row.selection_mode as 'automatic' | 'manual' | 'none',
    eligibilityRevision: row.eligibility_revision,
    eligibilityFingerprint: row.eligibility_fingerprint,
    representationPolicyId: row.representation_policy_id,
    representationPolicyFingerprint: row.representation_policy_fingerprint,
    representationFingerprint: row.representation_fingerprint,
    lexicalGenerationId: row.lexical_generation_id,
    lexicalGenerationFingerprint: row.lexical_generation_fingerprint,
    activationRevision: row.activation_revision,
    activationFingerprint: row.activation_fingerprint,
    activatedAt: row.activated_at,
    stateChangedAt: row.state_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface LockedFamilyIdentity {
  readonly id: string;
  readonly provider: string;
  readonly corpCode: string;
  readonly symbol: string;
  readonly lineageRootReceiptNumber: string;
}

export interface ActivationTransitionWrite {
  readonly state: FilingRetrievalActivationState;
  readonly eventType: FilingRetrievalActivationEvent;
  readonly reasonCode: FilingRetrievalActivationReason;
  readonly eventFingerprint: string;
  readonly previousReceiptId: string | null;
  readonly previousDocumentId: string | null;
}

export class FilingRetrievalActivationRepository {
  constructor(private readonly pool: Pool) {}

  transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, operation);
  }

  async lockFamily(client: PoolClient, familyId: string): Promise<LockedFamilyIdentity | null> {
    const result = await client.query<{
      id: string; provider: string; corp_code: string; symbol: string;
      lineage_root_receipt_number: string;
    }>(
      `SELECT family.id::text, family.provider, family.corp_code, family.symbol,
              root.receipt_number AS lineage_root_receipt_number
       FROM filing_intelligence.filing_report_family AS family
       JOIN filing_intelligence.filing_receipt AS root
         ON root.id = family.lineage_root_receipt_id
       WHERE family.id = $1
       FOR UPDATE OF family`,
      [familyId],
    );
    const row = result.rows[0];
    return row == null ? null : {
      id: row.id, provider: row.provider, corpCode: row.corp_code, symbol: row.symbol,
      lineageRootReceiptNumber: row.lineage_root_receipt_number,
    };
  }

  async lockCurrent(
    client: PoolClient,
    familyId: string,
    retrievalPolicyId: string,
  ): Promise<FilingRetrievalActivationState | null> {
    const result = await client.query<ActivationRow>(
      `SELECT ${ACTIVATION_COLUMNS}
       FROM filing_intelligence.filing_retrieval_activation
       WHERE family_id = $1 AND retrieval_policy_id = $2
       FOR UPDATE`,
      [familyId, retrievalPolicyId],
    );
    return result.rows[0] == null ? null : mapRow(result.rows[0]);
  }

  async lockManualControl(client: PoolClient, familyId: string): Promise<void> {
    await client.query(
      `SELECT family_id
       FROM filing_intelligence.filing_family_resolution_control
       WHERE family_id = $1
       FOR UPDATE`,
      [familyId],
    );
  }

  async findCompatibleDocumentIds(
    client: PoolClient,
    receiptId: string,
    policy: {
      readonly canonicalSchemaName: string; readonly canonicalSchemaVersion: string;
      readonly parserVersion: string; readonly chunkSchemaVersion: string;
      readonly chunkerVersion: string;
    },
  ): Promise<readonly string[]> {
    const result = await client.query<{ id: string }>(
      `SELECT id::text
       FROM filing_intelligence.filing_document
       WHERE receipt_id = $1 AND canonical_schema_name = $2
         AND canonical_schema_version = $3 AND parser_version = $4
         AND chunk_schema_version = $5 AND chunker_version = $6
       ORDER BY id`,
      [receiptId, policy.canonicalSchemaName, policy.canonicalSchemaVersion,
        policy.parserVersion, policy.chunkSchemaVersion, policy.chunkerVersion],
    );
    return result.rows.map(row => row.id);
  }

  async stabilizeSelectedReceipt(
    client: PoolClient,
    familyId: string,
    receiptId: string,
  ): Promise<void> {
    const result = await client.query<{ id: string }>(
      `SELECT receipt.id::text
       FROM filing_intelligence.filing_report_family_member AS member
       JOIN filing_intelligence.filing_receipt AS receipt ON receipt.id = member.receipt_id
       WHERE member.family_id = $1 AND member.receipt_id = $2
       FOR UPDATE OF receipt`,
      [familyId, receiptId],
    );
    if (result.rows[0] == null) return integrity();
  }

  async lockCandidateDocuments(
    client: PoolClient,
    documentIds: readonly string[],
  ): Promise<void> {
    if (documentIds.length === 0) return;
    const result = await client.query<{ id: string }>(
      `SELECT id::text
       FROM filing_intelligence.filing_document
       WHERE id = ANY($1::bigint[])
       ORDER BY id
       FOR SHARE`,
      [documentIds],
    );
    if (result.rows.length !== documentIds.length) return integrity();
  }

  async writeTransition(
    client: PoolClient,
    transition: ActivationTransitionWrite,
  ): Promise<FilingRetrievalActivationState> {
    if (!includes(ACTIVATION_EVENTS, transition.eventType)
      || !includes(ACTIVATION_REASONS, transition.reasonCode)) return integrity();
    const state = transition.state;
    const values = [
      state.familyId, state.retrievalPolicyId, state.retrievalPolicyFingerprint,
      state.status, state.receiptId, state.documentId, state.familyRevision,
      state.familyFingerprint, state.resolutionFingerprint, state.resolverId,
      state.resolverVersion, state.manualControlRevision, state.selectionMode,
      state.eligibilityRevision, state.eligibilityFingerprint,
      state.representationPolicyId, state.representationPolicyFingerprint,
      state.representationFingerprint, state.lexicalGenerationId,
      state.lexicalGenerationFingerprint, state.activationRevision,
      state.activationFingerprint, state.activatedAt, state.stateChangedAt,
      state.createdAt, state.updatedAt,
    ];
    const written = await client.query<ActivationRow>(
      `INSERT INTO filing_intelligence.filing_retrieval_activation (
         family_id, retrieval_policy_id, retrieval_policy_fingerprint, status,
         receipt_id, document_id, family_revision, family_fingerprint,
         resolution_fingerprint, resolver_id, resolver_version, manual_control_revision,
         selection_mode, eligibility_revision, eligibility_fingerprint,
         representation_policy_id, representation_policy_fingerprint,
         representation_fingerprint, lexical_generation_id,
         lexical_generation_fingerprint, activation_revision, activation_fingerprint,
         activated_at, state_changed_at, created_at, updated_at
       ) VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')})
       ON CONFLICT (family_id, retrieval_policy_id) DO UPDATE SET
         retrieval_policy_fingerprint = EXCLUDED.retrieval_policy_fingerprint,
         status = EXCLUDED.status, receipt_id = EXCLUDED.receipt_id,
         document_id = EXCLUDED.document_id, family_revision = EXCLUDED.family_revision,
         family_fingerprint = EXCLUDED.family_fingerprint,
         resolution_fingerprint = EXCLUDED.resolution_fingerprint,
         resolver_id = EXCLUDED.resolver_id, resolver_version = EXCLUDED.resolver_version,
         manual_control_revision = EXCLUDED.manual_control_revision,
         selection_mode = EXCLUDED.selection_mode,
         eligibility_revision = EXCLUDED.eligibility_revision,
         eligibility_fingerprint = EXCLUDED.eligibility_fingerprint,
         representation_policy_id = EXCLUDED.representation_policy_id,
         representation_policy_fingerprint = EXCLUDED.representation_policy_fingerprint,
         representation_fingerprint = EXCLUDED.representation_fingerprint,
         lexical_generation_id = EXCLUDED.lexical_generation_id,
         lexical_generation_fingerprint = EXCLUDED.lexical_generation_fingerprint,
         activation_revision = EXCLUDED.activation_revision,
         activation_fingerprint = EXCLUDED.activation_fingerprint,
         activated_at = EXCLUDED.activated_at,
         state_changed_at = EXCLUDED.state_changed_at,
         updated_at = EXCLUDED.updated_at
       RETURNING ${ACTIVATION_COLUMNS}`,
      values,
    );
    const historyValues = [
      state.familyId, state.retrievalPolicyId, state.activationRevision,
      transition.eventType, transition.previousReceiptId, transition.previousDocumentId,
      state.receiptId, state.documentId, state.familyRevision, state.familyFingerprint,
      state.resolutionFingerprint, state.resolverId, state.resolverVersion,
      state.manualControlRevision, state.selectionMode, state.eligibilityRevision,
      state.eligibilityFingerprint, state.representationPolicyId,
      state.representationPolicyFingerprint, state.representationFingerprint,
      state.lexicalGenerationId, state.lexicalGenerationFingerprint,
      transition.reasonCode, state.activationFingerprint, transition.eventFingerprint,
      state.stateChangedAt, state.stateChangedAt,
    ];
    await client.query(
      `INSERT INTO filing_intelligence.filing_retrieval_activation_history (
         family_id, retrieval_policy_id, activation_revision, event_type,
         previous_receipt_id, previous_document_id, new_receipt_id, new_document_id,
         family_revision, family_fingerprint, resolution_fingerprint, resolver_id,
         resolver_version, manual_control_revision, selection_mode,
         eligibility_revision, eligibility_fingerprint, representation_policy_id,
         representation_policy_fingerprint, representation_fingerprint,
         lexical_generation_id, lexical_generation_fingerprint, reason_code,
         activation_fingerprint, event_fingerprint, occurred_at, created_at
       ) VALUES (${historyValues.map((_, index) => `$${index + 1}`).join(', ')})`,
      historyValues,
    );
    const row = written.rows[0];
    return row == null ? integrity() : mapRow(row);
  }
}
