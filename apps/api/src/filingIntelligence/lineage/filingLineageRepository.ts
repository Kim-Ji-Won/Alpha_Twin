import { Pool, PoolClient } from 'pg';

import { withTransaction } from '../../infrastructure/database/transaction.js';
import {
  CorrectionRelationPersistenceResult,
  FilingReceiptMetadataInput,
  PersistVerifiedCorrectionRelationInput,
  PersistVerifiedReportFamilyInput,
  ReceiptPersistenceResult,
  ReportFamilyPersistenceResult,
  VerifiedRelationSource,
} from './contracts.js';
import { FilingLineageError, FilingLineageErrorCode } from './errors.js';
import { lineageFingerprint } from './fingerprints.js';
import {
  PreparedReceiptMetadata,
  validateFamilyInput,
  validateReceiptMetadata,
  validateRelationInput,
} from './validation.js';

interface ReceiptRow {
  id: string;
  provider: string;
  receipt_number: string;
  corp_code: string;
  symbol: string;
  company_name: string | null;
  report_name: string | null;
  report_code: string | null;
  filing_date: string | null;
  has_subsequent_correction: boolean;
  is_withdrawn: boolean;
  legal_status: PreparedReceiptMetadata['legalStatus'];
  metadata_observed_at: Date;
  provider_final_observed_at: Date | null;
  metadata_fingerprint: string;
}

interface FamilyRow {
  id: string;
  provider: string;
  corp_code: string;
  symbol: string;
  lineage_root_receipt_id: string;
  verification_source: VerifiedRelationSource;
  verification_reference_hash: string;
  family_fingerprint: string;
  revision: string;
}

interface RelationRow {
  id: string;
  corrects_receipt_id: string;
  relation_fingerprint: string;
}

function sameNullable(left: string | null, right: string | undefined): boolean {
  return (left ?? undefined) === right;
}

function postgresCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof error.code === 'string' ? error.code : undefined;
}

function mapError(error: unknown): FilingLineageError {
  if (error instanceof FilingLineageError) return error;
  const code = postgresCode(error);
  if (code === '23503' || code === '23514' || code === '22P02') {
    return new FilingLineageError('FILING_LINEAGE_INTEGRITY_FAILURE', false, { cause: error });
  }
  if (code === '23505') {
    return new FilingLineageError('FILING_CORRECTION_RELATION_CONFLICT', false, { cause: error });
  }
  const retryable = code == null || code.startsWith('08')
    || code === '40P01' || code === '40001' || code === '57014';
  return new FilingLineageError('FILING_LINEAGE_TRANSACTION_FAILED', retryable, { cause: error });
}

function assertReceiptIdentity(row: ReceiptRow, input: PreparedReceiptMetadata): void {
  if (row.provider !== input.provider
    || row.receipt_number !== input.receiptNumber
    || row.corp_code !== input.corpCode
    || row.symbol !== input.symbol
    || !sameNullable(row.company_name, input.companyName)
    || !sameNullable(row.report_name, input.reportName)
    || !sameNullable(row.report_code, input.reportCode)
    || (row.filing_date ?? undefined) !== input.filingDate) {
    throw new FilingLineageError('FILING_RECEIPT_IDENTITY_CONFLICT', false);
  }
}

async function findReceiptForUpdate(
  client: PoolClient,
  provider: string,
  receiptNumber: string,
): Promise<ReceiptRow | undefined> {
  const result = await client.query<ReceiptRow>(
    `SELECT id::text, provider, receipt_number, corp_code, symbol, company_name,
            report_name, report_code, filing_date::text, has_subsequent_correction,
            is_withdrawn, legal_status, metadata_observed_at,
            provider_final_observed_at, metadata_fingerprint
     FROM filing_intelligence.filing_receipt
     WHERE provider = $1 AND receipt_number = $2
     FOR UPDATE`,
    [provider, receiptNumber],
  );
  return result.rows[0];
}

function assertSafeObservationTransition(
  existing: ReceiptRow,
  incoming: PreparedReceiptMetadata,
): void {
  const terminal = existing.legal_status === 'withdrawn' || existing.legal_status === 'cancelled';
  const terminalStatusChanged = terminal && incoming.legalStatus !== existing.legal_status;
  const activeStatusBecameUnknown = existing.legal_status === 'reported_active'
    && incoming.legalStatus === 'unknown';
  if (terminalStatusChanged
    || activeStatusBecameUnknown
    || (existing.is_withdrawn && !incoming.isWithdrawn)
    || (existing.has_subsequent_correction && !incoming.hasSubsequentCorrection)) {
    throw new FilingLineageError('FILING_RECEIPT_OBSERVATION_CONFLICT', false);
  }
}

export async function persistReceiptWithClient(
  client: PoolClient,
  input: FilingReceiptMetadataInput,
): Promise<ReceiptPersistenceResult> {
  const value = validateReceiptMetadata(input);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO filing_intelligence.filing_receipt (
       provider, receipt_number, corp_code, symbol, company_name, report_name,
       report_code, filing_date, filer_name, disclosure_category,
       disclosure_detail_type, correction_type, has_subsequent_correction,
       is_withdrawn, legal_status, lineage_status, metadata_source,
       metadata_observed_at, provider_final_observed_at, metadata_fingerprint
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, 'unresolved', $16, $17, $18, $19
     )
     ON CONFLICT ON CONSTRAINT filing_receipt_provider_number_unique DO NOTHING
     RETURNING id::text`,
    [
      value.provider, value.receiptNumber, value.corpCode, value.symbol,
      value.companyName ?? null, value.reportName ?? null, value.reportCode ?? null,
      value.filingDate ?? null, value.filerName ?? null,
      value.disclosureCategory ?? null, value.disclosureDetailType ?? null,
      value.correctionType, value.hasSubsequentCorrection, value.isWithdrawn,
      value.legalStatus, value.metadataSource, value.metadataObservedAt,
      value.providerFinalObservedAt ?? null, value.metadataFingerprint,
    ],
  );
  const insertedId = inserted.rows[0]?.id;
  if (insertedId) {
    return { status: 'inserted', receiptId: insertedId, metadataFingerprint: value.metadataFingerprint };
  }

  const existing = await findReceiptForUpdate(client, value.provider, value.receiptNumber);
  if (!existing) throw new FilingLineageError('FILING_LINEAGE_TRANSACTION_FAILED', true);
  assertReceiptIdentity(existing, value);
  if (existing.metadata_fingerprint === value.metadataFingerprint) {
    const finalObservedAt = value.providerFinalObservedAt == null
      ? undefined : new Date(value.providerFinalObservedAt);
    if (finalObservedAt != null
      && (existing.provider_final_observed_at == null
        || finalObservedAt > existing.provider_final_observed_at)) {
      await client.query(
        `UPDATE filing_intelligence.filing_receipt
         SET provider_final_observed_at = $2, updated_at = clock_timestamp()
         WHERE id = $1`,
        [existing.id, finalObservedAt],
      );
      return {
        status: 'observation_updated',
        receiptId: existing.id,
        metadataFingerprint: value.metadataFingerprint,
      };
    }
    return { status: 'already_present', receiptId: existing.id, metadataFingerprint: value.metadataFingerprint };
  }
  const observed = new Date(value.metadataObservedAt).getTime();
  const existingObserved = existing.metadata_observed_at.getTime();
  if (observed < existingObserved) {
    return { status: 'already_present', receiptId: existing.id, metadataFingerprint: existing.metadata_fingerprint };
  }
  if (observed === existingObserved) {
    throw new FilingLineageError('FILING_RECEIPT_OBSERVATION_CONFLICT', false);
  }
  assertSafeObservationTransition(existing, value);
  await client.query(
    `UPDATE filing_intelligence.filing_receipt
     SET filer_name = $2, disclosure_category = $3, disclosure_detail_type = $4,
         correction_type = $5, has_subsequent_correction = $6,
         is_withdrawn = $7, legal_status = $8, metadata_source = $9,
         metadata_observed_at = $10,
         provider_final_observed_at = CASE
           WHEN $11::timestamptz IS NULL THEN provider_final_observed_at
           WHEN provider_final_observed_at IS NULL OR $11::timestamptz > provider_final_observed_at
             THEN $11::timestamptz
           ELSE provider_final_observed_at
         END,
         metadata_fingerprint = $12, updated_at = clock_timestamp()
     WHERE id = $1`,
    [
      existing.id, value.filerName ?? null, value.disclosureCategory ?? null,
      value.disclosureDetailType ?? null, value.correctionType,
      value.hasSubsequentCorrection, value.isWithdrawn, value.legalStatus,
      value.metadataSource, value.metadataObservedAt,
      value.providerFinalObservedAt ?? null, value.metadataFingerprint,
    ],
  );
  return { status: 'observation_updated', receiptId: existing.id, metadataFingerprint: value.metadataFingerprint };
}

function familyBaseFingerprint(input: PersistVerifiedReportFamilyInput): string {
  return lineageFingerprint({
    provider: input.provider,
    corpCode: input.corpCode,
    symbol: input.symbol,
    rootReceiptNumber: input.lineageRootReceiptNumber,
    members: [{ receiptNumber: input.lineageRootReceiptNumber, role: 'root' }],
    edges: [],
  });
}

async function requireCompanyReceipt(
  client: PoolClient,
  input: Pick<PersistVerifiedReportFamilyInput, 'provider' | 'corpCode' | 'symbol'>,
  receiptNumber: string,
  notFoundCode: FilingLineageErrorCode = 'FILING_CORRECTION_RECEIPT_NOT_FOUND',
): Promise<ReceiptRow> {
  const row = await findReceiptForUpdate(client, input.provider, receiptNumber);
  if (!row) throw new FilingLineageError(notFoundCode, false);
  if (row.corp_code !== input.corpCode || row.symbol !== input.symbol) {
    throw new FilingLineageError('FILING_CORRECTION_CROSS_COMPANY', false);
  }
  return row;
}

async function createOrGetFamily(
  client: PoolClient,
  input: PersistVerifiedReportFamilyInput,
): Promise<{ row: FamilyRow; inserted: boolean }> {
  const root = await requireCompanyReceipt(
    client,
    input,
    input.lineageRootReceiptNumber,
    'FILING_FAMILY_ROOT_UNVERIFIED',
  );
  const fingerprint = familyBaseFingerprint(input);
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO filing_intelligence.filing_report_family (
       provider, corp_code, symbol, lineage_root_receipt_id, family_status,
       verification_source, verification_reference_hash, family_fingerprint
     ) VALUES ($1, $2, $3, $4, 'verified', $5, $6, $7)
     ON CONFLICT ON CONSTRAINT filing_report_family_identity_unique DO NOTHING
     RETURNING id::text`,
    [input.provider, input.corpCode, input.symbol, root.id,
      input.verificationSource, input.verificationReferenceHash, fingerprint],
  );
  const familyResult = await client.query<FamilyRow>(
    `SELECT id::text, provider, corp_code, symbol, lineage_root_receipt_id::text,
            verification_source, verification_reference_hash,
            family_fingerprint, revision::text
     FROM filing_intelligence.filing_report_family
     WHERE provider = $1 AND corp_code = $2 AND lineage_root_receipt_id = $3
     FOR UPDATE`,
    [input.provider, input.corpCode, root.id],
  );
  const family = familyResult.rows[0];
  if (!family) throw new FilingLineageError('FILING_LINEAGE_TRANSACTION_FAILED', true);
  if (family.symbol !== input.symbol
    || family.verification_source !== input.verificationSource
    || family.verification_reference_hash !== input.verificationReferenceHash) {
    throw new FilingLineageError('FILING_FAMILY_IDENTITY_CONFLICT', false);
  }
  const membershipFingerprint = lineageFingerprint({
    familyRoot: input.lineageRootReceiptNumber,
    receiptNumber: input.lineageRootReceiptNumber,
    role: 'root',
    source: input.verificationSource,
  });
  await client.query(
    `INSERT INTO filing_intelligence.filing_report_family_member (
       family_id, receipt_id, provider, corp_code, symbol, member_role,
       membership_source, membership_fingerprint
     ) VALUES ($1, $2, $3, $4, $5, 'root', $6, $7)
     ON CONFLICT (family_id, receipt_id) DO NOTHING`,
    [family.id, root.id, input.provider, input.corpCode, input.symbol,
      input.verificationSource, membershipFingerprint],
  );
  return { row: family, inserted: inserted.rowCount === 1 };
}

async function addMember(
  client: PoolClient,
  family: FamilyRow,
  receipt: ReceiptRow,
  source: VerifiedRelationSource,
  rootReceiptNumber: string,
): Promise<void> {
  const role = receipt.id === family.lineage_root_receipt_id ? 'root' : 'correction';
  const fingerprint = lineageFingerprint({
    familyRoot: rootReceiptNumber,
    receiptNumber: receipt.receipt_number,
    role,
    source,
  });
  const inserted = await client.query(
    `INSERT INTO filing_intelligence.filing_report_family_member (
       family_id, receipt_id, provider, corp_code, symbol, member_role,
       membership_source, membership_fingerprint
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (family_id, receipt_id) DO NOTHING`,
    [family.id, receipt.id, family.provider, family.corp_code, family.symbol,
      role, source, fingerprint],
  );
  if (inserted.rowCount === 0) {
    const owner = await client.query<{
      family_id: string; member_role: string; membership_source: string;
    }>(
      `SELECT family_id::text, member_role, membership_source
       FROM filing_intelligence.filing_report_family_member WHERE receipt_id = $1`,
      [receipt.id],
    );
    const row = owner.rows[0];
    if (!row || row.family_id !== family.id || row.member_role !== role) {
      throw new FilingLineageError('FILING_FAMILY_IDENTITY_CONFLICT', false);
    }
  }
}

async function calculateFamilyGraphFingerprint(
  client: PoolClient,
  family: FamilyRow,
): Promise<string> {
  const root = await client.query<{ receipt_number: string }>(
    `SELECT receipt_number
     FROM filing_intelligence.filing_receipt
     WHERE id = $1`,
    [family.lineage_root_receipt_id],
  );
  const rootReceiptNumber = root.rows[0]?.receipt_number;
  if (!rootReceiptNumber) {
    throw new FilingLineageError('FILING_LINEAGE_INTEGRITY_FAILURE', false);
  }
  const members = await client.query<{
    receipt_number: string;
    member_role: string;
    membership_fingerprint: string;
  }>(
    `SELECT receipt.receipt_number, member.member_role, member.membership_fingerprint
     FROM filing_intelligence.filing_report_family_member AS member
     JOIN filing_intelligence.filing_receipt AS receipt ON receipt.id = member.receipt_id
     WHERE member.family_id = $1
     ORDER BY receipt.receipt_number, member.member_role`,
    [family.id],
  );
  const edges = await client.query<{
    correction_receipt_number: string;
    corrects_receipt_number: string;
    relation_type: string;
    relation_fingerprint: string;
  }>(
    `SELECT correction.receipt_number AS correction_receipt_number,
            corrected.receipt_number AS corrects_receipt_number,
            relation.relation_type, relation.relation_fingerprint
     FROM filing_intelligence.filing_correction_relation AS relation
     JOIN filing_intelligence.filing_receipt AS correction
       ON correction.id = relation.correction_receipt_id
     JOIN filing_intelligence.filing_receipt AS corrected
       ON corrected.id = relation.corrects_receipt_id
     WHERE relation.family_id = $1
     ORDER BY correction.receipt_number, corrected.receipt_number,
              relation.relation_type, relation.relation_fingerprint`,
    [family.id],
  );
  return lineageFingerprint({
    provider: family.provider,
    corpCode: family.corp_code,
    symbol: family.symbol,
    rootReceiptNumber,
    members: members.rows,
    edges: edges.rows,
  });
}

export class FilingLineageRepository {
  constructor(private readonly pool: Pool) {}

  async persistReceipt(input: FilingReceiptMetadataInput): Promise<ReceiptPersistenceResult> {
    try {
      return await withTransaction(this.pool, client => persistReceiptWithClient(client, input));
    } catch (error) {
      throw mapError(error);
    }
  }

  async persistVerifiedReportFamily(
    input: PersistVerifiedReportFamilyInput,
  ): Promise<ReportFamilyPersistenceResult> {
    validateFamilyInput(input);
    try {
      return await withTransaction(this.pool, async client => {
        const family = await createOrGetFamily(client, input);
        return {
          status: family.inserted ? 'inserted' : 'already_present',
          familyId: family.row.id,
          revision: family.row.revision,
          familyFingerprint: family.row.family_fingerprint,
        };
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  async persistVerifiedCorrectionRelation(
    input: PersistVerifiedCorrectionRelationInput,
  ): Promise<CorrectionRelationPersistenceResult> {
    validateRelationInput(input);
    try {
      return await withTransaction(this.pool, async client => {
        const root = await requireCompanyReceipt(
          client,
          input,
          input.lineageRootReceiptNumber,
          'FILING_FAMILY_ROOT_UNVERIFIED',
        );
        const correction = await requireCompanyReceipt(client, input, input.correctionReceiptNumber);
        const corrected = await requireCompanyReceipt(client, input, input.correctsReceiptNumber);
        const { row: family } = await createOrGetFamily(client, input);
        if (root.id !== family.lineage_root_receipt_id) {
          throw new FilingLineageError('FILING_FAMILY_ROOT_UNVERIFIED', false);
        }
        await addMember(client, family, correction, input.relationSource, input.lineageRootReceiptNumber);
        await addMember(client, family, corrected, input.relationSource, input.lineageRootReceiptNumber);

        const relationFingerprint = lineageFingerprint({
          familyRoot: input.lineageRootReceiptNumber,
          correctionReceiptNumber: input.correctionReceiptNumber,
          correctsReceiptNumber: input.correctsReceiptNumber,
          relationType: input.relationType,
          relationSource: input.relationSource,
          relationReferenceHash: input.relationReferenceHash,
        });
        const existing = await client.query<RelationRow>(
          `SELECT id::text, corrects_receipt_id::text, relation_fingerprint
           FROM filing_intelligence.filing_correction_relation
           WHERE family_id = $1 AND correction_receipt_id = $2 AND relation_type = $3`,
          [family.id, correction.id, input.relationType],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.corrects_receipt_id !== corrected.id
            || existingRow.relation_fingerprint !== relationFingerprint) {
            throw new FilingLineageError('FILING_CORRECTION_RELATION_CONFLICT', false);
          }
          return {
            status: 'already_present', relationId: existingRow.id, familyId: family.id,
            familyRevision: family.revision, familyFingerprint: family.family_fingerprint,
          };
        }

        const cycle = await client.query<{ cycle: boolean }>(
          `WITH RECURSIVE predecessors(receipt_id) AS (
             SELECT $2::bigint
             UNION
             SELECT relation.corrects_receipt_id
             FROM filing_intelligence.filing_correction_relation AS relation
             JOIN predecessors ON relation.correction_receipt_id = predecessors.receipt_id
             WHERE relation.family_id = $1
           )
           SELECT EXISTS(SELECT 1 FROM predecessors WHERE receipt_id = $3::bigint) AS cycle`,
          [family.id, corrected.id, correction.id],
        );
        if (cycle.rows[0]?.cycle) {
          throw new FilingLineageError('FILING_CORRECTION_CYCLE', false);
        }

        const inserted = await client.query<{ id: string }>(
          `INSERT INTO filing_intelligence.filing_correction_relation (
             family_id, correction_receipt_id, corrects_receipt_id, relation_type,
             relation_source, verification_reference_hash, relation_fingerprint, verified_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id::text`,
          [family.id, correction.id, corrected.id, input.relationType,
            input.relationSource, input.relationReferenceHash, relationFingerprint,
            new Date(input.verifiedAt).toISOString()],
        );
        const relationId = inserted.rows[0]?.id;
        if (!relationId) throw new FilingLineageError('FILING_LINEAGE_TRANSACTION_FAILED', true);
        await client.query(
          `UPDATE filing_intelligence.filing_receipt
           SET lineage_status = 'resolved', updated_at = clock_timestamp()
           WHERE id = ANY($1::bigint[]) AND lineage_status = 'unresolved'`,
          [[root.id, correction.id, corrected.id]],
        );
        const nextFingerprint = await calculateFamilyGraphFingerprint(client, family);
        const updated = await client.query<{ revision: string }>(
          `UPDATE filing_intelligence.filing_report_family
           SET family_fingerprint = $2, revision = revision + 1,
               updated_at = clock_timestamp()
           WHERE id = $1
           RETURNING revision::text`,
          [family.id, nextFingerprint],
        );
        return {
          status: 'inserted', relationId, familyId: family.id,
          familyRevision: updated.rows[0]!.revision,
          familyFingerprint: nextFingerprint,
        };
      });
    } catch (error) {
      throw mapError(error);
    }
  }
}
