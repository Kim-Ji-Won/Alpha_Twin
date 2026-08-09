import { Pool, PoolClient } from 'pg';

import {
  FILING_LEGAL_STATUSES,
  FILING_LINEAGE_STATUSES,
  FILING_PROVIDERS,
  VERIFIED_RELATION_SOURCES,
} from '../lineage/contracts.js';
import {
  RESOLUTION_CONTROL_MODES,
  RESOLUTION_REASON_CODES,
  ResolveFamilyInput,
  ResolutionControlMode,
  ResolutionMemberSnapshot,
  ResolutionReasonCode,
  ResolutionRelationSnapshot,
  StoredResolutionControl,
  VerifiedFamilyGraphSnapshot,
} from './contracts.js';
import { FilingResolutionError } from './errors.js';
import { validateResolveFamilyInput } from './validation.js';

interface RootRow {
  id: string;
  provider: string;
  receipt_number: string;
  corp_code: string;
  symbol: string;
}

interface FamilyRow {
  id: string;
  provider: string;
  corp_code: string;
  symbol: string;
  lineage_root_receipt_id: string;
  family_status: string;
  revision: string;
  family_fingerprint: string;
}

interface MemberRow {
  member_role: string;
  membership_source: string;
  membership_fingerprint: string;
  receipt_id: string;
  provider: string;
  receipt_number: string;
  corp_code: string;
  symbol: string;
  legal_status: string;
  lineage_status: string;
}

interface RelationRow {
  id: string;
  correction_receipt_id: string;
  corrects_receipt_id: string;
  relation_type: string;
  relation_source: string;
  verification_reference_hash: string;
  relation_fingerprint: string;
}

interface ControlRow {
  family_id: string;
  mode: string;
  selected_receipt_id: string | null;
  reason_code: string;
  reference_hash: string;
  actor_reference_hash: string | null;
  expires_at: Date | null;
  revision: string;
  control_fingerprint: string;
}

export interface GraphLoadResult {
  readonly databaseNow: string;
  readonly snapshot: VerifiedFamilyGraphSnapshot | null;
}

export interface GraphReadHooks {
  readonly afterFamilyRead?: () => Promise<void>;
}

function oneOf<T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.includes(value);
}

function integrity(): never {
  throw new FilingResolutionError('FILING_RESOLUTION_GRAPH_INTEGRITY_FAILURE', false);
}

function mapMember(row: MemberRow): ResolutionMemberSnapshot {
  if (!oneOf(FILING_PROVIDERS, row.provider)
    || !oneOf(FILING_LEGAL_STATUSES, row.legal_status)
    || !oneOf(FILING_LINEAGE_STATUSES, row.lineage_status)
    || !oneOf(VERIFIED_RELATION_SOURCES, row.membership_source)
    || (row.member_role !== 'root' && row.member_role !== 'correction')) return integrity();
  return {
    role: row.member_role,
    source: row.membership_source,
    membershipFingerprint: row.membership_fingerprint,
    receipt: {
      id: row.receipt_id,
      provider: row.provider,
      receiptNumber: row.receipt_number,
      corpCode: row.corp_code,
      symbol: row.symbol,
      legalStatus: row.legal_status,
      lineageStatus: row.lineage_status,
    },
  };
}

function mapRelation(row: RelationRow): ResolutionRelationSnapshot {
  if (row.relation_type !== 'corrects'
    || !oneOf(VERIFIED_RELATION_SOURCES, row.relation_source)) return integrity();
  return {
    id: row.id,
    correctionReceiptId: row.correction_receipt_id,
    correctsReceiptId: row.corrects_receipt_id,
    relationType: row.relation_type,
    relationSource: row.relation_source,
    verificationReferenceHash: row.verification_reference_hash,
    relationFingerprint: row.relation_fingerprint,
  };
}

function mapControl(row: ControlRow | undefined): StoredResolutionControl | null {
  if (!row) return null;
  if (!oneOf(RESOLUTION_CONTROL_MODES, row.mode)
    || !oneOf(RESOLUTION_REASON_CODES, row.reason_code)) return integrity();
  return {
    familyId: row.family_id,
    mode: row.mode as ResolutionControlMode,
    selectedReceiptId: row.selected_receipt_id,
    reasonCode: row.reason_code as ResolutionReasonCode,
    referenceHash: row.reference_hash,
    actorReferenceHash: row.actor_reference_hash,
    expiresAt: row.expires_at?.toISOString() ?? null,
    revision: row.revision,
    controlFingerprint: row.control_fingerprint,
  };
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' ? error.code : undefined;
}

function mapError(error: unknown): FilingResolutionError {
  if (error instanceof FilingResolutionError) return error;
  const code = postgresCode(error);
  const retryable = code == null || code.startsWith('08')
    || code === '40P01' || code === '40001' || code === '57014';
  return new FilingResolutionError('FILING_RESOLUTION_TRANSACTION_FAILED', retryable, {
    cause: error,
  });
}

async function readSnapshot(
  client: PoolClient,
  input: ResolveFamilyInput,
  hooks: GraphReadHooks,
): Promise<GraphLoadResult> {
  const now = await client.query<{ database_now: Date }>('SELECT clock_timestamp() AS database_now');
  const databaseNow = now.rows[0]!.database_now.toISOString();
  const rootResult = await client.query<RootRow>(
    `SELECT id::text, provider, receipt_number, corp_code, symbol
     FROM filing_intelligence.filing_receipt
     WHERE provider = $1 AND receipt_number = $2`,
    [input.provider, input.lineageRootReceiptNumber],
  );
  const root = rootResult.rows[0];
  if (!root) return { databaseNow, snapshot: null };
  if (root.corp_code !== input.corpCode || root.symbol !== input.symbol) {
    throw new FilingResolutionError('FILING_RESOLUTION_FAMILY_IDENTITY_MISMATCH', false);
  }
  const familyResult = await client.query<FamilyRow>(
    `SELECT id::text, provider, corp_code, symbol, lineage_root_receipt_id::text,
            family_status, revision::text, family_fingerprint
     FROM filing_intelligence.filing_report_family
     WHERE provider = $1 AND corp_code = $2 AND lineage_root_receipt_id = $3`,
    [input.provider, input.corpCode, root.id],
  );
  const family = familyResult.rows[0];
  if (!family) return { databaseNow, snapshot: null };
  if (!oneOf(FILING_PROVIDERS, family.provider)
    || family.symbol !== input.symbol
    || family.lineage_root_receipt_id !== root.id
    || !['verified', 'conflicted', 'quarantined'].includes(family.family_status)) return integrity();
  await hooks.afterFamilyRead?.();
  const members = await client.query<MemberRow>(
    `SELECT member.member_role, member.membership_source, member.membership_fingerprint,
            receipt.id::text AS receipt_id, receipt.provider, receipt.receipt_number,
            receipt.corp_code, receipt.symbol, receipt.legal_status, receipt.lineage_status
     FROM filing_intelligence.filing_report_family_member AS member
     JOIN filing_intelligence.filing_receipt AS receipt ON receipt.id = member.receipt_id
     WHERE member.family_id = $1
     ORDER BY receipt.receipt_number, receipt.id`,
    [family.id],
  );
  const relations = await client.query<RelationRow>(
    `SELECT id::text, correction_receipt_id::text, corrects_receipt_id::text,
            relation_type, relation_source, verification_reference_hash,
            relation_fingerprint
     FROM filing_intelligence.filing_correction_relation
     WHERE family_id = $1
     ORDER BY correction_receipt_id, corrects_receipt_id, id`,
    [family.id],
  );
  const control = await client.query<ControlRow>(
    `SELECT family_id::text, mode, selected_receipt_id::text, reason_code,
            reference_hash, actor_reference_hash, expires_at,
            revision::text, control_fingerprint
     FROM filing_intelligence.filing_family_resolution_control
     WHERE family_id = $1`,
    [family.id],
  );
  return {
    databaseNow,
    snapshot: {
      databaseNow,
      family: {
        id: family.id,
        provider: family.provider,
        corpCode: family.corp_code,
        symbol: family.symbol,
        lineageRootReceiptId: family.lineage_root_receipt_id,
        lineageRootReceiptNumber: root.receipt_number,
        status: family.family_status as 'verified' | 'conflicted' | 'quarantined',
        revision: family.revision,
        fingerprint: family.family_fingerprint,
      },
      members: members.rows.map(mapMember),
      relations: relations.rows.map(mapRelation),
      manualControl: mapControl(control.rows[0]),
    },
  };
}

export class VerifiedFilingGraphRepository {
  constructor(
    private readonly pool: Pool,
    private readonly hooks: GraphReadHooks = {},
  ) {}

  async load(input: ResolveFamilyInput): Promise<GraphLoadResult> {
    validateResolveFamilyInput(input);
    const client = await this.pool.connect();
    let destroy = false;
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await readSnapshot(client, input, this.hooks);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        destroy = true;
      }
      throw mapError(error);
    } finally {
      client.release(destroy);
    }
  }
}
