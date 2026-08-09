import { Pool, PoolClient } from 'pg';

import { withTransaction } from '../../infrastructure/database/transaction.js';
import { lineageFingerprint } from '../lineage/fingerprints.js';
import {
  ClearResolutionControlInput,
  ResolutionControlAction,
  ResolutionControlMode,
  ResolutionControlPersistenceResult,
  ResolutionReasonCode,
  SetManualReceiptSelectionInput,
  SetResolutionHoldInput,
} from './contracts.js';
import { FilingResolutionError } from './errors.js';
import {
  validateClearInput,
  validateHoldInput,
  validateSelectionInput,
} from './validation.js';

interface ControlRow {
  family_id: string;
  mode: ResolutionControlMode;
  selected_receipt_id: string | null;
  reason_code: ResolutionReasonCode;
  reference_hash: string;
  actor_reference_hash: string | null;
  expires_at: Date | null;
  revision: string;
  control_fingerprint: string;
}

interface ControlState {
  readonly mode: ResolutionControlMode;
  readonly selectedReceiptId: string | null;
  readonly reasonCode: ResolutionReasonCode;
  readonly referenceHash: string;
  readonly actorReferenceHash: string | null;
  readonly expiresAt: string | null;
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' ? error.code : undefined;
}

function mapError(error: unknown): FilingResolutionError {
  if (error instanceof FilingResolutionError) return error;
  const code = postgresCode(error);
  if (code === '23503') {
    return new FilingResolutionError('FILING_RESOLUTION_MANUAL_SELECTION_CROSS_FAMILY', false, {
      cause: error,
    });
  }
  if (code === '23505' || code === '23514' || code === '22P02') {
    return new FilingResolutionError('FILING_RESOLUTION_CONTROL_INVALID', false, { cause: error });
  }
  const retryable = code == null || code.startsWith('08')
    || code === '40P01' || code === '40001' || code === '57014';
  return new FilingResolutionError('FILING_RESOLUTION_TRANSACTION_FAILED', retryable, {
    cause: error,
  });
}

function controlFingerprint(familyId: string, state: ControlState): string {
  return lineageFingerprint({ familyId, ...state });
}

async function requireFamily(client: PoolClient, familyId: string): Promise<void> {
  const family = await client.query<{ id: string }>(
    `SELECT id::text
     FROM filing_intelligence.filing_report_family
     WHERE id = $1
     FOR UPDATE`,
    [familyId],
  );
  if (!family.rows[0]) {
    throw new FilingResolutionError('FILING_RESOLUTION_CONTROL_INVALID', false);
  }
}

async function currentControl(client: PoolClient, familyId: string): Promise<ControlRow | undefined> {
  const result = await client.query<ControlRow>(
    `SELECT family_id::text, mode, selected_receipt_id::text, reason_code,
            reference_hash, actor_reference_hash, expires_at,
            revision::text, control_fingerprint
     FROM filing_intelligence.filing_family_resolution_control
     WHERE family_id = $1
     FOR UPDATE`,
    [familyId],
  );
  return result.rows[0];
}

function assertExpectedRevision(row: ControlRow | undefined, expected: string | null): void {
  if ((row == null && expected != null) || (row != null && row.revision !== expected)) {
    throw new FilingResolutionError('FILING_RESOLUTION_CONTROL_STALE', false);
  }
}

async function requireEligibleMember(
  client: PoolClient,
  familyId: string,
  receiptId: string,
): Promise<void> {
  const result = await client.query<{
    legal_status: string;
    lineage_status: string;
    reaches_root: boolean;
  }>(
    `WITH RECURSIVE selected AS (
       SELECT receipt.legal_status, receipt.lineage_status
       FROM filing_intelligence.filing_report_family_member AS member
       JOIN filing_intelligence.filing_receipt AS receipt ON receipt.id = member.receipt_id
       WHERE member.family_id = $1 AND member.receipt_id = $2
     ), path(receipt_id, visited) AS (
       SELECT member.receipt_id, ARRAY[member.receipt_id]
       FROM filing_intelligence.filing_report_family_member AS member
       WHERE member.family_id = $1 AND member.receipt_id = $2
       UNION ALL
       SELECT relation.corrects_receipt_id, path.visited || relation.corrects_receipt_id
       FROM path
       JOIN filing_intelligence.filing_correction_relation AS relation
         ON relation.family_id = $1 AND relation.correction_receipt_id = path.receipt_id
       WHERE NOT relation.corrects_receipt_id = ANY(path.visited)
     )
     SELECT selected.legal_status, selected.lineage_status,
            EXISTS (
              SELECT 1
              FROM path
              JOIN filing_intelligence.filing_report_family AS family
                ON family.id = $1 AND family.lineage_root_receipt_id = path.receipt_id
            ) AS reaches_root
     FROM selected`,
    [familyId, receiptId],
  );
  const receipt = result.rows[0];
  if (!receipt) {
    throw new FilingResolutionError('FILING_RESOLUTION_MANUAL_SELECTION_CROSS_FAMILY', false);
  }
  if (receipt.legal_status === 'withdrawn' || receipt.legal_status === 'cancelled'
    || receipt.lineage_status === 'conflicted' || receipt.lineage_status === 'quarantined') {
    throw new FilingResolutionError('FILING_RESOLUTION_MANUAL_SELECTION_INELIGIBLE', false);
  }
  if (!receipt.reaches_root) {
    throw new FilingResolutionError('FILING_RESOLUTION_MANUAL_SELECTION_INELIGIBLE', false);
  }
}

async function persistControl(
  client: PoolClient,
  familyId: string,
  expectedRevision: string | null,
  action: ResolutionControlAction,
  state: ControlState,
): Promise<ResolutionControlPersistenceResult> {
  await requireFamily(client, familyId);
  const current = await currentControl(client, familyId);
  assertExpectedRevision(current, expectedRevision);
  if (state.selectedReceiptId != null) {
    await requireEligibleMember(client, familyId, state.selectedReceiptId);
  }
  const fingerprint = controlFingerprint(familyId, state);
  if (current?.control_fingerprint === fingerprint) {
    return {
      status: 'already_present',
      familyId,
      mode: current.mode,
      selectedReceiptId: current.selected_receipt_id,
      revision: current.revision,
      controlFingerprint: current.control_fingerprint,
    };
  }
  const nextRevision = current == null ? '1' : (BigInt(current.revision) + 1n).toString();
  const result = await client.query<{ revision: string }>(
    `INSERT INTO filing_intelligence.filing_family_resolution_control (
       family_id, mode, selected_receipt_id, reason_code, reference_hash,
       actor_reference_hash, expires_at, revision, control_fingerprint
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (family_id) DO UPDATE SET
       mode = EXCLUDED.mode,
       selected_receipt_id = EXCLUDED.selected_receipt_id,
       reason_code = EXCLUDED.reason_code,
       reference_hash = EXCLUDED.reference_hash,
       actor_reference_hash = EXCLUDED.actor_reference_hash,
       expires_at = EXCLUDED.expires_at,
       revision = EXCLUDED.revision,
       control_fingerprint = EXCLUDED.control_fingerprint,
       updated_at = clock_timestamp()
     RETURNING revision::text`,
    [familyId, state.mode, state.selectedReceiptId, state.reasonCode,
      state.referenceHash, state.actorReferenceHash, state.expiresAt,
      nextRevision, fingerprint],
  );
  await client.query(
    `INSERT INTO filing_intelligence.filing_family_resolution_control_history (
       family_id, control_revision, action, resulting_mode, selected_receipt_id,
       reason_code, reference_hash, actor_reference_hash, expires_at, control_fingerprint
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [familyId, nextRevision, action, state.mode, state.selectedReceiptId,
      state.reasonCode, state.referenceHash, state.actorReferenceHash,
      state.expiresAt, fingerprint],
  );
  return {
    status: 'updated',
    familyId,
    mode: state.mode,
    selectedReceiptId: state.selectedReceiptId,
    revision: result.rows[0]!.revision,
    controlFingerprint: fingerprint,
  };
}

export class FilingResolutionControlRepository {
  constructor(private readonly pool: Pool) {}

  async setHold(input: SetResolutionHoldInput): Promise<ResolutionControlPersistenceResult> {
    validateHoldInput(input);
    const state: ControlState = {
      mode: 'hold',
      selectedReceiptId: null,
      reasonCode: input.reasonCode,
      referenceHash: input.referenceHash,
      actorReferenceHash: input.actorReferenceHash ?? null,
      expiresAt: input.expiresAt == null ? null : new Date(input.expiresAt).toISOString(),
    };
    try {
      return await withTransaction(this.pool, client => persistControl(
        client, input.familyId, input.expectedRevision, 'hold', state,
      ));
    } catch (error) {
      throw mapError(error);
    }
  }

  async setManualSelection(
    input: SetManualReceiptSelectionInput,
  ): Promise<ResolutionControlPersistenceResult> {
    validateSelectionInput(input);
    const state: ControlState = {
      mode: 'select',
      selectedReceiptId: input.selectedReceiptId,
      reasonCode: input.reasonCode,
      referenceHash: input.referenceHash,
      actorReferenceHash: input.actorReferenceHash ?? null,
      expiresAt: input.expiresAt == null ? null : new Date(input.expiresAt).toISOString(),
    };
    try {
      return await withTransaction(this.pool, client => persistControl(
        client, input.familyId, input.expectedRevision, 'select', state,
      ));
    } catch (error) {
      throw mapError(error);
    }
  }

  async clear(input: ClearResolutionControlInput): Promise<ResolutionControlPersistenceResult> {
    validateClearInput(input);
    const state: ControlState = {
      mode: 'automatic',
      selectedReceiptId: null,
      reasonCode: input.reasonCode,
      referenceHash: input.referenceHash,
      actorReferenceHash: input.actorReferenceHash ?? null,
      expiresAt: null,
    };
    try {
      return await withTransaction(this.pool, client => persistControl(
        client, input.familyId, input.expectedRevision, 'clear', state,
      ));
    } catch (error) {
      throw mapError(error);
    }
  }
}
