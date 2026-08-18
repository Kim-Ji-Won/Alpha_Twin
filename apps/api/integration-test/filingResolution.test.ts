import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import {
  FilingLineageRepository,
} from '../src/filingIntelligence/lineage/filingLineageRepository.js';
import {
  familyGraphFingerprint,
  lineageFingerprint,
} from '../src/filingIntelligence/lineage/fingerprints.js';
import {
  FilingDocumentRepository,
} from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import {
  FilingResolutionControlRepository,
} from '../src/filingIntelligence/resolution/controlRepository.js';
import { FilingResolutionError } from '../src/filingIntelligence/resolution/errors.js';
import {
  GraphReadHooks,
  VerifiedFilingGraphRepository,
} from '../src/filingIntelligence/resolution/graphRepository.js';
import { FilingResolutionService } from '../src/filingIntelligence/resolution/service.js';
import {
  clearPersistence,
  requiredTestDatabaseUrl,
  runMigrations,
} from './helpers/database.js';
import { syntheticPersistenceInputFor } from './helpers/filingFixture.js';

const HASH = 'b'.repeat(64);
const ROOT = '20990301000000';
const A1 = '20990301000001';
const A2 = '20990301000002';
const OTHER = '20990301000003';
const COMPANY = { corpCode: '33333333', symbol: '333333' };
const OTHER_COMPANY = { corpCode: '44444444', symbol: '444444' };

function receipt(
  receiptNumber: string,
  company = COMPANY,
  overrides: Record<string, unknown> = {},
) {
  return {
    provider: 'opendart-fss' as const,
    receiptNumber,
    ...company,
    companyName: company === COMPANY ? 'RESOLUTION COMPANY' : 'OTHER COMPANY',
    reportName: '합성 사업보고서',
    reportCode: '11011',
    filingDate: '2099-03-01',
    legalStatus: 'reported_active' as const,
    metadataSource: 'resolution-integration-test',
    metadataObservedAt: '2099-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function family(root = ROOT, company = COMPANY) {
  return {
    provider: 'opendart-fss' as const,
    ...company,
    lineageRootReceiptNumber: root,
    verificationSource: 'trusted_backfill' as const,
    verificationReferenceHash: HASH,
  };
}

function relation(correctionReceiptNumber: string, correctsReceiptNumber: string) {
  return {
    ...family(),
    correctionReceiptNumber,
    correctsReceiptNumber,
    relationType: 'corrects' as const,
    relationSource: 'trusted_backfill' as const,
    relationReferenceHash: HASH,
    verifiedAt: '2099-03-02T00:00:00.000Z',
  };
}

function resolveInput(root = ROOT, company = COMPANY) {
  return {
    provider: 'opendart-fss' as const,
    ...company,
    lineageRootReceiptNumber: root,
  };
}

function resolutionError(code: FilingResolutionError['code']) {
  return (error: unknown) => error instanceof FilingResolutionError && error.code === code;
}

async function exists(pool: Pool, name: string): Promise<boolean> {
  const result = await pool.query<{ relation: string | null }>(
    'SELECT to_regclass($1)::text AS relation', [name],
  );
  return result.rows[0]?.relation != null;
}

async function rootOnly(pool: Pool, legalStatus: 'unknown' | 'reported_active' = 'reported_active') {
  const lineage = new FilingLineageRepository(pool);
  await lineage.persistReceipt(receipt(ROOT, COMPANY, { legalStatus }));
  return lineage.persistVerifiedReportFamily(family());
}

async function chain(pool: Pool, includeSecond = false) {
  const lineage = new FilingLineageRepository(pool);
  for (const number of includeSecond ? [ROOT, A1, A2] : [ROOT, A1]) {
    await lineage.persistReceipt(receipt(number));
  }
  const first = await lineage.persistVerifiedCorrectionRelation(relation(A1, ROOT));
  if (includeSecond) await lineage.persistVerifiedCorrectionRelation(relation(A2, A1));
  return first.familyId;
}

async function chainWithDisconnected(pool: Pool) {
  const lineage = new FilingLineageRepository(pool);
  const familyId = await chain(pool);
  const disconnected = await lineage.persistReceipt(receipt(A2));
  const source = 'trusted_backfill' as const;
  const membershipFingerprint = (receiptNumber: string, role: 'root' | 'correction') =>
    lineageFingerprint({ familyRoot: ROOT, receiptNumber, role, source });
  await pool.query(
    `INSERT INTO filing_intelligence.filing_report_family_member (
       family_id, receipt_id, provider, corp_code, symbol, member_role,
       membership_source, membership_fingerprint
     ) VALUES ($1, $2, 'opendart-fss', $3, $4, 'correction', $5, $6)`,
    [familyId, disconnected.receiptId, COMPANY.corpCode, COMPANY.symbol,
      source, membershipFingerprint(A2, 'correction')],
  );
  const relationFingerprint = lineageFingerprint({
    familyRoot: ROOT,
    correctionReceiptNumber: A1,
    correctsReceiptNumber: ROOT,
    relationType: 'corrects',
    relationSource: source,
    relationReferenceHash: HASH,
  });
  const fingerprint = familyGraphFingerprint({
    provider: 'opendart-fss', ...COMPANY, rootReceiptNumber: ROOT,
    members: [
      { receipt_number: ROOT, member_role: 'root',
        membership_fingerprint: membershipFingerprint(ROOT, 'root') },
      { receipt_number: A1, member_role: 'correction',
        membership_fingerprint: membershipFingerprint(A1, 'correction') },
      { receipt_number: A2, member_role: 'correction',
        membership_fingerprint: membershipFingerprint(A2, 'correction') },
    ],
    edges: [{
      correction_receipt_number: A1,
      corrects_receipt_number: ROOT,
      relation_type: 'corrects',
      relation_fingerprint: relationFingerprint,
    }],
  });
  await pool.query(
    `UPDATE filing_intelligence.filing_report_family
     SET family_fingerprint = $2, revision = revision + 1 WHERE id = $1`,
    [familyId, fingerprint],
  );
  const connected = await pool.query<{ id: string }>(
    'SELECT id::text FROM filing_intelligence.filing_receipt WHERE receipt_number = $1', [A1],
  );
  return {
    familyId,
    connectedReceiptId: connected.rows[0]!.id,
    disconnectedReceiptId: disconnected.receiptId,
  };
}

test('verified filing resolution PostgreSQL integration', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 30_000,
    application_name: 'alpha-twin-resolution-integration-test',
  });
  t.after(async () => pool.end());

  await t.test('migration up, no-op, down, and re-up preserve every prior table', async () => {
    await runMigrations('up', databaseUrl);
    await runMigrations('up', databaseUrl);
    for (const table of [
      'filing_intelligence.filing_family_resolution_control',
      'filing_intelligence.filing_family_resolution_control_history',
    ]) assert.equal(await exists(pool, table), true);
    const constraints = await pool.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_schema = 'filing_intelligence'`,
    );
    const names = new Set(constraints.rows.map(row => row.constraint_name));
    for (const name of [
      'filing_family_resolution_control_selected_member_fk',
      'filing_family_resolution_control_history_selected_member_fk',
      'filing_family_resolution_control_history_revision_unique',
    ]) assert.equal(names.has(name), true, name);
    const deleteRules = await pool.query<{ constraint_name: string; delete_rule: string }>(
      `SELECT constraint_name, delete_rule
       FROM information_schema.referential_constraints
       WHERE constraint_schema = 'filing_intelligence'
         AND constraint_name IN (
           'filing_family_resolution_control_family_id_fkey',
           'filing_family_resolution_control_history_family_id_fkey'
         )
       ORDER BY constraint_name`,
    );
    assert.deepEqual(deleteRules.rows, [
      { constraint_name: 'filing_family_resolution_control_family_id_fkey', delete_rule: 'RESTRICT' },
      { constraint_name: 'filing_family_resolution_control_history_family_id_fkey', delete_rule: 'RESTRICT' },
    ]);
    await runMigrations('down', databaseUrl);
    assert.equal(await exists(pool, 'filing_intelligence.filing_retrieval_eligibility'), false);
    assert.equal(await exists(pool, 'filing_intelligence.filing_family_resolution_control'), true);
    await runMigrations('down', databaseUrl);
    assert.equal(await exists(pool, 'filing_intelligence.filing_family_resolution_control'), false);
    for (const table of [
      'filing_intelligence.filing_receipt',
      'filing_intelligence.filing_report_family',
      'filing_intelligence.filing_report_family_member',
      'filing_intelligence.filing_correction_relation',
      'filing_intelligence.filing_document',
      'filing_intelligence.filing_ingestion_job',
      'filing_intelligence.filing_chunk_lexical',
      'public.pgmigrations',
    ]) assert.equal(await exists(pool, table), true, table);
    await runMigrations('up', databaseUrl);
  });

  await t.test('root-only, linear, branch, incomplete, and missing families resolve conservatively', async () => {
    await clearPersistence(pool);
    const service = new FilingResolutionService(new VerifiedFilingGraphRepository(pool));
    await rootOnly(pool);
    assert.deepEqual(
      (await service.resolveCurrentEffectiveReceiptCandidate(resolveInput())).selectedReceiptNumber,
      ROOT,
    );

    await clearPersistence(pool);
    await chain(pool, true);
    assert.equal((await service.resolveCurrentEffectiveReceiptCandidate(resolveInput())).selectedReceiptNumber, A2);

    await clearPersistence(pool);
    const lineage = new FilingLineageRepository(pool);
    for (const number of [ROOT, A1, A2]) await lineage.persistReceipt(receipt(number));
    await lineage.persistVerifiedCorrectionRelation(relation(A1, ROOT));
    await lineage.persistVerifiedCorrectionRelation(relation(A2, ROOT));
    const branch = await service.resolveCurrentEffectiveReceiptCandidate(resolveInput());
    assert.equal(branch.resolutionStatus, 'ambiguous_terminal_branch');
    assert.deepEqual(branch.terminalReceiptNumbers, [A1, A2]);

    await clearPersistence(pool);
    await chainWithDisconnected(pool);
    assert.equal((await service.resolveCurrentEffectiveReceiptCandidate(resolveInput())).resolutionStatus,
      'graph_incomplete');

    await clearPersistence(pool);
    await lineage.persistReceipt(receipt(ROOT));
    assert.equal((await service.resolveCurrentEffectiveReceiptCandidate(resolveInput())).resolutionStatus,
      'family_not_found');
    await assert.rejects(
      service.resolveCurrentEffectiveReceiptCandidate(resolveInput(ROOT, OTHER_COMPANY)),
      resolutionError('FILING_RESOLUTION_FAMILY_IDENTITY_MISMATCH'),
    );
  });

  await t.test('stored fingerprint, legal, and lineage states are revalidated', async () => {
    await clearPersistence(pool);
    const service = new FilingResolutionService(new VerifiedFilingGraphRepository(pool));
    const created = await rootOnly(pool);
    await pool.query(
      `UPDATE filing_intelligence.filing_report_family
       SET family_fingerprint = repeat('f', 64) WHERE id = $1`, [created.familyId],
    );
    await assert.rejects(
      service.resolveCurrentEffectiveReceiptCandidate(resolveInput()),
      resolutionError('FILING_RESOLUTION_GRAPH_INTEGRITY_FAILURE'),
    );

    for (const legalStatus of ['unknown', 'withdrawn', 'cancelled'] as const) {
      await clearPersistence(pool);
      await rootOnly(pool, legalStatus === 'unknown' ? 'unknown' : 'reported_active');
      if (legalStatus !== 'unknown') {
        await pool.query(
          'UPDATE filing_intelligence.filing_receipt SET legal_status = $1 WHERE receipt_number = $2',
          [legalStatus, ROOT],
        );
      }
      const result = await service.resolveCurrentEffectiveReceiptCandidate(resolveInput());
      assert.equal(result.resolutionStatus, legalStatus === 'unknown'
        ? 'legal_status_unresolved' : 'terminal_legally_ineligible');
    }

    await clearPersistence(pool);
    await chain(pool);
    for (const lineageStatus of ['unresolved', 'conflicted', 'quarantined'] as const) {
      await pool.query(
        'UPDATE filing_intelligence.filing_receipt SET lineage_status = $1 WHERE receipt_number = $2',
        [lineageStatus, A1],
      );
      assert.equal((await service.resolveCurrentEffectiveReceiptCandidate(resolveInput())).resolutionStatus,
        'lineage_status_ineligible');
    }
  });

  await t.test('manual control is atomic, revisioned, idempotent, and history-backed', async () => {
    await clearPersistence(pool);
    const familyId = await chain(pool, true);
    const controls = new FilingResolutionControlRepository(pool);
    const holdInput = {
      familyId,
      expectedRevision: null,
      reasonCode: 'emergency_hold' as const,
      referenceHash: HASH,
      actorReferenceHash: 'c'.repeat(64),
      expiresAt: '2099-04-01T00:00:00.000Z',
    };
    const hold = await controls.setHold(holdInput);
    assert.equal(hold.revision, '1');
    const beforeNoOp = await pool.query<{ updated_at: Date }>(
      `SELECT updated_at
       FROM filing_intelligence.filing_family_resolution_control
       WHERE family_id = $1`, [familyId],
    );
    const noOp = await controls.setHold({ ...holdInput, expectedRevision: '1' });
    assert.deepEqual([noOp.status, noOp.revision], ['already_present', '1']);
    const afterNoOp = await pool.query<{ updated_at: Date }>(
      `SELECT updated_at
       FROM filing_intelligence.filing_family_resolution_control
       WHERE family_id = $1`, [familyId],
    );
    assert.deepEqual(afterNoOp.rows[0], beforeNoOp.rows[0]);
    const selectedReceipt = await pool.query<{ id: string }>(
      `SELECT id::text FROM filing_intelligence.filing_receipt WHERE receipt_number = $1`, [A1],
    );
    const selected = await controls.setManualSelection({
      familyId,
      selectedReceiptId: selectedReceipt.rows[0]!.id,
      expectedRevision: '1',
      reasonCode: 'rollback_candidate',
      referenceHash: HASH,
    });
    assert.equal(selected.revision, '2');
    const cleared = await controls.clear({
      familyId,
      expectedRevision: '2',
      reasonCode: 'control_cleared',
      referenceHash: HASH,
    });
    assert.deepEqual([cleared.mode, cleared.revision], ['automatic', '3']);
    const rows = await pool.query<{
      current_revision: string; latest_history_revision: string; history: number;
    }>(`SELECT
      (SELECT revision::text FROM filing_intelligence.filing_family_resolution_control
       WHERE family_id = $1) AS current_revision,
      (SELECT max(control_revision)::text
       FROM filing_intelligence.filing_family_resolution_control_history
       WHERE family_id = $1) AS latest_history_revision,
      (SELECT count(*)::integer FROM filing_intelligence.filing_family_resolution_control_history
       WHERE family_id = $1) AS history`, [familyId]);
    assert.deepEqual(rows.rows[0], {
      current_revision: '3', latest_history_revision: '3', history: 3,
    });
    await assert.rejects(
      controls.setHold({ ...holdInput, expectedRevision: '1' }),
      resolutionError('FILING_RESOLUTION_CONTROL_STALE'),
    );
    await pool.query(
      'DELETE FROM filing_intelligence.filing_family_resolution_control WHERE family_id = $1',
      [familyId],
    );
    const preservedHistory = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM filing_intelligence.filing_family_resolution_control_history
       WHERE family_id = $1`, [familyId],
    );
    assert.equal(preservedHistory.rows[0]?.count, 3);
    await assert.rejects(pool.query(
      'DELETE FROM filing_intelligence.filing_report_family WHERE id = $1', [familyId],
    ));
  });

  await t.test('manual selection respects same-family and eligibility boundaries', async () => {
    await clearPersistence(pool);
    const lineage = new FilingLineageRepository(pool);
    const familyId = await chain(pool);
    await lineage.persistReceipt(receipt(OTHER, OTHER_COMPANY));
    const otherFamily = await lineage.persistVerifiedReportFamily(family(OTHER, OTHER_COMPANY));
    const receipts = await pool.query<{ id: string; receipt_number: string }>(
      `SELECT id::text, receipt_number FROM filing_intelligence.filing_receipt
       WHERE receipt_number = ANY($1::text[])`, [[A1, OTHER]],
    );
    const ids = new Map(receipts.rows.map(row => [row.receipt_number, row.id]));
    const controls = new FilingResolutionControlRepository(pool);
    await assert.rejects(controls.setManualSelection({
      familyId, selectedReceiptId: ids.get(OTHER)!, expectedRevision: null,
      reasonCode: 'manual_verified_selection', referenceHash: HASH,
    }), resolutionError('FILING_RESOLUTION_MANUAL_SELECTION_CROSS_FAMILY'));
    await assert.rejects(pool.query(
      `INSERT INTO filing_intelligence.filing_family_resolution_control (
         family_id, mode, selected_receipt_id, reason_code, reference_hash,
         revision, control_fingerprint
       ) VALUES ($1, 'select', $2, 'manual_verified_selection', $3, 1, $3)`,
      [familyId, ids.get(OTHER), HASH],
    ));
    await pool.query(
      `UPDATE filing_intelligence.filing_receipt
       SET legal_status = 'withdrawn' WHERE receipt_number = $1`, [A1],
    );
    await assert.rejects(controls.setManualSelection({
      familyId, selectedReceiptId: ids.get(A1)!, expectedRevision: null,
      reasonCode: 'manual_verified_selection', referenceHash: HASH,
    }), resolutionError('FILING_RESOLUTION_MANUAL_SELECTION_INELIGIBLE'));
    assert.ok(otherFamily.familyId);

    await clearPersistence(pool);
    const incomplete = await chainWithDisconnected(pool);
    const incompleteControls = new FilingResolutionControlRepository(pool);
    await incompleteControls.setManualSelection({
      familyId: incomplete.familyId,
      selectedReceiptId: incomplete.connectedReceiptId,
      expectedRevision: null,
      reasonCode: 'manual_verified_selection',
      referenceHash: HASH,
    });
    const selected = await new FilingResolutionService(
      new VerifiedFilingGraphRepository(pool),
    ).resolveCurrentEffectiveReceiptCandidate(resolveInput());
    assert.deepEqual([selected.resolutionStatus, selected.selectedReceiptId],
      ['manual_selected', incomplete.connectedReceiptId]);
    await assert.rejects(incompleteControls.setManualSelection({
      familyId: incomplete.familyId,
      selectedReceiptId: incomplete.disconnectedReceiptId,
      expectedRevision: '1',
      reasonCode: 'manual_verified_selection',
      referenceHash: HASH,
    }), resolutionError('FILING_RESOLUTION_MANUAL_SELECTION_INELIGIBLE'));
  });

  await t.test('active and expired controls use database time and never mutate graph completeness', async () => {
    await clearPersistence(pool);
    const familyId = await chain(pool, true);
    const controls = new FilingResolutionControlRepository(pool);
    const service = new FilingResolutionService(new VerifiedFilingGraphRepository(pool));
    await controls.setHold({
      familyId, expectedRevision: null, reasonCode: 'emergency_hold', referenceHash: HASH,
      expiresAt: '2099-04-01T00:00:00.000Z',
    });
    assert.equal((await service.resolveCurrentEffectiveReceiptCandidate(resolveInput())).resolutionStatus,
      'manual_hold');
    await controls.setHold({
      familyId, expectedRevision: '1', reasonCode: 'emergency_hold', referenceHash: HASH,
      expiresAt: '2000-01-01T00:00:00.000Z',
    });
    assert.equal((await service.resolveCurrentEffectiveReceiptCandidate(resolveInput())).resolutionStatus,
      'resolved');

    await clearPersistence(pool);
    const boundaryFamily = await rootOnly(pool);
    const boundary = await pool.query<{ expires_at: Date }>(
      `SELECT clock_timestamp() + interval '1 second' AS expires_at`,
    );
    await controls.setHold({
      familyId: boundaryFamily.familyId,
      expectedRevision: null,
      reasonCode: 'emergency_hold',
      referenceHash: HASH,
      expiresAt: boundary.rows[0]!.expires_at.toISOString(),
    });
    let releaseRead!: () => void;
    let familyRead!: () => void;
    const readStarted = new Promise<void>(resolve => { familyRead = resolve; });
    const release = new Promise<void>(resolve => { releaseRead = resolve; });
    const snapshotService = new FilingResolutionService(new VerifiedFilingGraphRepository(pool, {
      afterFamilyRead: async () => {
        familyRead();
        await release;
      },
    }));
    const pending = snapshotService.resolveCurrentEffectiveReceiptCandidate(resolveInput());
    await readStarted;
    await new Promise(resolve => setTimeout(resolve, 1_300));
    releaseRead();
    assert.equal((await pending).resolutionStatus, 'manual_hold');
    assert.equal((await service.resolveCurrentEffectiveReceiptCandidate(resolveInput())).resolutionStatus,
      'resolved');
  });

  await t.test('concurrent control mutations allow one winner without duplicate history', async () => {
    await clearPersistence(pool);
    const familyId = await chain(pool);
    const selected = await pool.query<{ id: string }>(
      'SELECT id::text FROM filing_intelligence.filing_receipt WHERE receipt_number = $1', [A1],
    );
    const controls = new FilingResolutionControlRepository(pool);
    const outcomes = await Promise.allSettled([
      controls.setHold({
        familyId, expectedRevision: null, reasonCode: 'emergency_hold', referenceHash: HASH,
      }),
      controls.setManualSelection({
        familyId, selectedReceiptId: selected.rows[0]!.id, expectedRevision: null,
        reasonCode: 'manual_verified_selection', referenceHash: HASH,
      }),
    ]);
    assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
    const rejected = outcomes.find(value => value.status === 'rejected');
    assert.ok(rejected?.status === 'rejected');
    assert.equal(resolutionError('FILING_RESOLUTION_CONTROL_STALE')(rejected.reason), true);
    const counts = await pool.query<{ current_rows: number; history_rows: number }>(`SELECT
      (SELECT count(*)::integer FROM filing_intelligence.filing_family_resolution_control) AS current_rows,
      (SELECT count(*)::integer FROM filing_intelligence.filing_family_resolution_control_history) AS history_rows`);
    assert.deepEqual(counts.rows[0], { current_rows: 1, history_rows: 1 });

    await clearPersistence(pool);
    const sameFamilyId = await chain(pool);
    const sameInput = {
      familyId: sameFamilyId,
      expectedRevision: null,
      reasonCode: 'emergency_hold' as const,
      referenceHash: HASH,
    };
    const sameOutcomes = await Promise.allSettled([
      controls.setHold(sameInput), controls.setHold(sameInput),
    ]);
    assert.equal(sameOutcomes.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(sameOutcomes.filter(value => value.status === 'rejected').length, 1);
    const sameCounts = await pool.query<{ current_revision: string; history_rows: number }>(`SELECT
      (SELECT revision::text FROM filing_intelligence.filing_family_resolution_control
       WHERE family_id = $1) AS current_revision,
      (SELECT count(*)::integer FROM filing_intelligence.filing_family_resolution_control_history
       WHERE family_id = $1) AS history_rows`, [sameFamilyId]);
    assert.deepEqual(sameCounts.rows[0], { current_revision: '1', history_rows: 1 });
  });

  await t.test('repeatable-read resolver returns one revision while a later call sees mutation', async () => {
    await clearPersistence(pool);
    const lineage = new FilingLineageRepository(pool);
    await chain(pool);
    await lineage.persistReceipt(receipt(A2));
    let releaseRead!: () => void;
    let familyRead!: () => void;
    const readStarted = new Promise<void>(resolve => { familyRead = resolve; });
    const release = new Promise<void>(resolve => { releaseRead = resolve; });
    const hooks: GraphReadHooks = {
      afterFamilyRead: async () => {
        familyRead();
        await release;
      },
    };
    const firstService = new FilingResolutionService(new VerifiedFilingGraphRepository(pool, hooks));
    const pending = firstService.resolveCurrentEffectiveReceiptCandidate(resolveInput());
    await readStarted;
    await lineage.persistVerifiedCorrectionRelation(relation(A2, A1));
    releaseRead();
    const first = await pending;
    const next = await new FilingResolutionService(
      new VerifiedFilingGraphRepository(pool),
    ).resolveCurrentEffectiveReceiptCandidate(resolveInput());
    assert.deepEqual([first.selectedReceiptNumber, next.selectedReceiptNumber], [A1, A2]);
    assert.notEqual(first.familyRevision, next.familyRevision);
    assert.notEqual(first.familyFingerprint, next.familyFingerprint);
  });

  await t.test('resolver is read-only and leaves document activation flags unchanged', async () => {
    await clearPersistence(pool);
    const documents = new FilingDocumentRepository(pool);
    const input = syntheticPersistenceInputFor({
      receiptNumber: ROOT, ...COMPANY, companyName: 'RESOLUTION COMPANY',
    });
    await documents.persistCanonicalFiling(input);
    await pool.query(
      `UPDATE filing_intelligence.filing_receipt
       SET legal_status = 'reported_active' WHERE receipt_number = $1`, [ROOT],
    );
    const lineage = new FilingLineageRepository(pool);
    await lineage.persistVerifiedReportFamily(family());
    const before = await pool.query<{
      family_revision: string; family_updated_at: Date; receipt_updated_at: Date;
      controls: number; history: number;
    }>(`SELECT family.revision::text AS family_revision,
              family.updated_at AS family_updated_at, receipt.updated_at AS receipt_updated_at,
              (SELECT count(*)::integer FROM filing_intelligence.filing_family_resolution_control) AS controls,
              (SELECT count(*)::integer FROM filing_intelligence.filing_family_resolution_control_history) AS history
       FROM filing_intelligence.filing_report_family family
       JOIN filing_intelligence.filing_receipt receipt
         ON receipt.id = family.lineage_root_receipt_id`);
    const service = new FilingResolutionService(new VerifiedFilingGraphRepository(pool));
    await service.resolveCurrentEffectiveReceiptCandidate(resolveInput());
    const after = await pool.query<typeof before.rows[number]>(`SELECT
              family.revision::text AS family_revision,
              family.updated_at AS family_updated_at, receipt.updated_at AS receipt_updated_at,
              (SELECT count(*)::integer FROM filing_intelligence.filing_family_resolution_control) AS controls,
              (SELECT count(*)::integer FROM filing_intelligence.filing_family_resolution_control_history) AS history
       FROM filing_intelligence.filing_report_family family
       JOIN filing_intelligence.filing_receipt receipt
         ON receipt.id = family.lineage_root_receipt_id`);
    assert.deepEqual(after.rows[0], before.rows[0]);
    const flags = await pool.query<{
      is_retrieval_ready: boolean; is_current_effective: boolean; activated_at: Date | null;
    }>(`SELECT is_retrieval_ready, is_current_effective, activated_at
        FROM filing_intelligence.filing_document`);
    assert.deepEqual(flags.rows[0], {
      is_retrieval_ready: false, is_current_effective: false, activated_at: null,
    });
  });

  await t.test('bounded graph resolution remains deterministic without external calls', async () => {
    await clearPersistence(pool);
    const lineage = new FilingLineageRepository(pool);
    const count = 100;
    const numbers = Array.from({ length: count }, (_, index) =>
      `20990401${String(index).padStart(6, '0')}`);
    for (const number of numbers) await lineage.persistReceipt(receipt(number));
    const familyInput = family(numbers[0]!);
    for (let index = 1; index < numbers.length; index += 1) {
      await lineage.persistVerifiedCorrectionRelation({
        ...familyInput,
        correctionReceiptNumber: numbers[index]!,
        correctsReceiptNumber: numbers[index - 1]!,
        relationType: 'corrects',
        relationSource: 'trusted_backfill',
        relationReferenceHash: HASH,
        verifiedAt: '2099-04-02T00:00:00.000Z',
      });
    }
    const service = new FilingResolutionService(new VerifiedFilingGraphRepository(pool));
    const values = await Promise.all(Array.from({ length: 200 }, () =>
      service.resolveCurrentEffectiveReceiptCandidate(resolveInput(numbers[0]!, COMPANY))));
    assert.equal(new Set(values.map(value => value.resolutionFingerprint)).size, 1);
    assert.equal(values[0]?.selectedReceiptNumber, numbers.at(-1));
  });
});
