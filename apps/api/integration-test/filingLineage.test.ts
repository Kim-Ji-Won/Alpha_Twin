import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import {
  FilingLineageRepository,
} from '../src/filingIntelligence/lineage/filingLineageRepository.js';
import { FilingLineageError } from '../src/filingIntelligence/lineage/errors.js';
import {
  FilingDocumentRepository,
} from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import {
  clearPersistence,
  requiredTestDatabaseUrl,
  runMigrations,
} from './helpers/database.js';
import { syntheticPersistenceInputFor } from './helpers/filingFixture.js';

const HASH = 'a'.repeat(64);
const VERIFIED_AT = '2099-01-05T00:00:00.000Z';
const COMPANY_A = { corpCode: '11111111', symbol: '111111' };
const COMPANY_B = { corpCode: '22222222', symbol: '222222' };
const A0 = '20990101001000';
const A1 = '20990101001001';
const A2 = '20990101001002';
const A3 = '20990101001003';
const B0 = '20990101002000';

function lineageError(code: FilingLineageError['code']) {
  return (error: unknown) => error instanceof FilingLineageError && error.code === code;
}

function receipt(
  receiptNumber: string,
  company = COMPANY_A,
  overrides: Record<string, unknown> = {},
) {
  return {
    provider: 'opendart-fss' as const,
    receiptNumber,
    ...company,
    companyName: company === COMPANY_A ? 'SYNTHETIC COMPANY A' : 'SYNTHETIC COMPANY B',
    reportName: '합성 사업보고서',
    reportCode: '11011',
    filingDate: '2099-01-01',
    metadataSource: 'synthetic-test',
    metadataObservedAt: '2099-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function family() {
  return {
    provider: 'opendart-fss' as const,
    ...COMPANY_A,
    lineageRootReceiptNumber: A0,
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
    verifiedAt: VERIFIED_AT,
  };
}

async function counts(pool: Pool) {
  const result = await pool.query<{
    receipts: number; families: number; members: number; relations: number;
  }>(`SELECT
    (SELECT count(*)::integer FROM filing_intelligence.filing_receipt) AS receipts,
    (SELECT count(*)::integer FROM filing_intelligence.filing_report_family) AS families,
    (SELECT count(*)::integer FROM filing_intelligence.filing_report_family_member) AS members,
    (SELECT count(*)::integer FROM filing_intelligence.filing_correction_relation) AS relations`);
  return result.rows[0]!;
}

test('filing receipt and verified correction PostgreSQL foundation', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 8,
    connectionTimeoutMillis: 2_000,
    statement_timeout: 30_000,
    application_name: 'alpha-twin-lineage-integration-test',
  });
  t.after(async () => pool.end());
  await runMigrations('up', databaseUrl);

  await t.test('schema exposes receipt ownership, family, relation, and document FK constraints', async () => {
    const constraints = await pool.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE constraint_schema = 'filing_intelligence'`,
    );
    const names = new Set(constraints.rows.map(row => row.constraint_name));
    for (const name of [
      'filing_receipt_provider_number_unique', 'filing_document_receipt_fk',
      'filing_report_family_root_fk', 'filing_report_family_member_receipt_unique',
      'filing_correction_relation_correction_member_fk',
      'filing_correction_relation_corrected_member_fk',
      'filing_correction_relation_self_check',
      'filing_correction_relation_predecessor_unique',
    ]) assert.equal(names.has(name), true, name);
  });

  await t.test('receipt observations are idempotent, monotonic, and identity-safe', async () => {
    await clearPersistence(pool);
    const repository = new FilingLineageRepository(pool);
    const first = await repository.persistReceipt(receipt(A0));
    const same = await repository.persistReceipt(receipt(A0, COMPANY_A, {
      metadataObservedAt: '2099-01-03T00:00:00.000Z',
    }));
    const updated = await repository.persistReceipt(receipt(A0, COMPANY_A, {
      hasSubsequentCorrection: true,
      metadataObservedAt: '2099-01-04T00:00:00.000Z',
    }));
    const older = await repository.persistReceipt(receipt(A0, COMPANY_A, {
      metadataObservedAt: '2099-01-01T00:00:00.000Z',
    }));
    const finalObservation = await repository.persistReceipt(receipt(A0, COMPANY_A, {
      hasSubsequentCorrection: true,
      metadataObservedAt: '2099-01-05T00:00:00.000Z',
      providerFinalObservedAt: '2099-01-05T00:00:00.000Z',
    }));
    assert.deepEqual(
      [first.status, same.status, updated.status, older.status, finalObservation.status],
      ['inserted', 'already_present', 'observation_updated', 'already_present', 'observation_updated'],
    );
    await assert.rejects(
      repository.persistReceipt(receipt(A0, COMPANY_A, {
        hasSubsequentCorrection: false,
        metadataObservedAt: '2099-01-04T00:00:00.000Z',
      })),
      lineageError('FILING_RECEIPT_OBSERVATION_CONFLICT'),
    );
    await assert.rejects(
      repository.persistReceipt(receipt(A0, COMPANY_B)),
      lineageError('FILING_RECEIPT_IDENTITY_CONFLICT'),
    );
  });

  await t.test('terminal legal and positive correction observations do not regress', async () => {
    await clearPersistence(pool);
    const repository = new FilingLineageRepository(pool);
    await repository.persistReceipt(receipt(A0, COMPANY_A, {
      hasSubsequentCorrection: true,
      isWithdrawn: true,
      legalStatus: 'withdrawn',
      metadataObservedAt: '2099-01-03T00:00:00.000Z',
    }));
    await assert.rejects(
      repository.persistReceipt(receipt(A0, COMPANY_A, {
        hasSubsequentCorrection: false,
        legalStatus: 'reported_active',
        metadataObservedAt: '2099-01-04T00:00:00.000Z',
      })),
      lineageError('FILING_RECEIPT_OBSERVATION_CONFLICT'),
    );
    const state = await pool.query<{
      legal_status: string; is_withdrawn: boolean; has_subsequent_correction: boolean;
    }>(`SELECT legal_status, is_withdrawn, has_subsequent_correction
        FROM filing_intelligence.filing_receipt
        WHERE provider = 'opendart-fss' AND receipt_number = $1`, [A0]);
    assert.deepEqual(state.rows[0], {
      legal_status: 'withdrawn',
      is_withdrawn: true,
      has_subsequent_correction: true,
    });

    await clearPersistence(pool);
    await repository.persistReceipt(receipt(A0, COMPANY_A, {
      legalStatus: 'cancelled',
      metadataObservedAt: '2099-01-03T00:00:00.000Z',
    }));
    await assert.rejects(
      repository.persistReceipt(receipt(A0, COMPANY_A, {
        legalStatus: 'reported_active',
        metadataObservedAt: '2099-01-04T00:00:00.000Z',
      })),
      lineageError('FILING_RECEIPT_OBSERVATION_CONFLICT'),
    );
  });

  await t.test('canonical persistence creates one receipt for multiple document representations', async () => {
    await clearPersistence(pool);
    const repository = new FilingDocumentRepository(pool);
    const base = syntheticPersistenceInputFor({
      receiptNumber: A0, ...COMPANY_A, companyName: 'SYNTHETIC COMPANY A',
    });
    const first = await repository.persistCanonicalFiling(base);
    const secondInput = syntheticPersistenceInputFor({
      receiptNumber: A0, ...COMPANY_A, companyName: 'SYNTHETIC COMPANY A',
      paragraphTexts: ['다른 source representation'],
    });
    const second = await repository.persistCanonicalFiling(secondInput);
    const rows = await pool.query<{ receipts: number; documents: number; distinct_receipts: number }>(
      `SELECT
        (SELECT count(*)::integer FROM filing_intelligence.filing_receipt) AS receipts,
        count(*)::integer AS documents,
        count(DISTINCT receipt_id)::integer AS distinct_receipts
       FROM filing_intelligence.filing_document`,
    );
    assert.notEqual(first.documentId, second.documentId);
    assert.deepEqual(rows.rows[0], { receipts: 1, documents: 2, distinct_receipts: 1 });
  });

  await t.test('receipt conflict rolls back canonical document and child writes', async () => {
    await clearPersistence(pool);
    const documents = new FilingDocumentRepository(pool);
    await documents.persistCanonicalFiling(syntheticPersistenceInputFor({
      receiptNumber: A0, ...COMPANY_A, companyName: 'SYNTHETIC COMPANY A',
    }));
    await assert.rejects(documents.persistCanonicalFiling(syntheticPersistenceInputFor({
      receiptNumber: A0, ...COMPANY_B, companyName: 'SYNTHETIC COMPANY B',
    })));
    const row = await pool.query<{ documents: number; receipts: number }>(`SELECT
      (SELECT count(*)::integer FROM filing_intelligence.filing_document) AS documents,
      (SELECT count(*)::integer FROM filing_intelligence.filing_receipt) AS receipts`);
    assert.deepEqual(row.rows[0], { documents: 1, receipts: 1 });
  });

  await t.test('correction observations remain unresolved and never infer family rows', async () => {
    await clearPersistence(pool);
    const repository = new FilingLineageRepository(pool);
    await repository.persistReceipt(receipt(A1, COMPANY_A, {
      reportName: '[기재정정] 합성 사업보고서',
      correctionType: 'content-correction',
      hasSubsequentCorrection: true,
    }));
    assert.deepEqual(await counts(pool), { receipts: 1, families: 0, members: 0, relations: 0 });
    const state = await pool.query<{ lineage_status: string }>(
      'SELECT lineage_status FROM filing_intelligence.filing_receipt',
    );
    assert.equal(state.rows[0]?.lineage_status, 'unresolved');
  });

  await t.test('verified family and A2 to A1 to A0 chain are idempotent', async () => {
    await clearPersistence(pool);
    const repository = new FilingLineageRepository(pool);
    for (const number of [A0, A1, A2]) await repository.persistReceipt(receipt(number));
    const created = await repository.persistVerifiedReportFamily(family());
    const repeated = await repository.persistVerifiedReportFamily(family());
    const unresolvedRoot = await pool.query<{ lineage_status: string }>(
      `SELECT lineage_status FROM filing_intelligence.filing_receipt
       WHERE receipt_number = $1`,
      [A0],
    );
    assert.equal(unresolvedRoot.rows[0]?.lineage_status, 'unresolved');
    const first = await repository.persistVerifiedCorrectionRelation(relation(A1, A0));
    const second = await repository.persistVerifiedCorrectionRelation(relation(A2, A1));
    const duplicate = await repository.persistVerifiedCorrectionRelation(relation(A2, A1));
    assert.deepEqual([created.status, repeated.status], ['inserted', 'already_present']);
    assert.deepEqual([first.status, second.status, duplicate.status],
      ['inserted', 'inserted', 'already_present']);
    assert.deepEqual(await counts(pool), { receipts: 3, families: 1, members: 3, relations: 2 });
    assert.equal(second.familyRevision, '3');
    assert.equal(duplicate.familyRevision, '3');
  });

  await t.test('self, unknown, cross-company, and multiple predecessor relations fail closed', async () => {
    await clearPersistence(pool);
    const repository = new FilingLineageRepository(pool);
    for (const number of [A0, A1, A2]) await repository.persistReceipt(receipt(number));
    await repository.persistReceipt(receipt(B0, COMPANY_B));
    await assert.rejects(
      repository.persistVerifiedReportFamily({ ...family(), lineageRootReceiptNumber: A3 }),
      lineageError('FILING_FAMILY_ROOT_UNVERIFIED'),
    );
    await assert.rejects(
      repository.persistVerifiedCorrectionRelation(relation(A1, A1)),
      lineageError('FILING_CORRECTION_SELF_REFERENCE'),
    );
    await assert.rejects(
      repository.persistVerifiedCorrectionRelation(relation(A3, A0)),
      lineageError('FILING_CORRECTION_RECEIPT_NOT_FOUND'),
    );
    await assert.rejects(
      repository.persistVerifiedCorrectionRelation(relation(B0, A0)),
      lineageError('FILING_CORRECTION_CROSS_COMPANY'),
    );
    await repository.persistVerifiedCorrectionRelation(relation(A1, A0));
    await assert.rejects(
      repository.persistVerifiedCorrectionRelation(relation(A1, A2)),
      lineageError('FILING_CORRECTION_RELATION_CONFLICT'),
    );
    assert.deepEqual(await counts(pool), { receipts: 4, families: 1, members: 2, relations: 1 });
  });

  await t.test('cycle insertion rolls back edge, membership, and family revision', async () => {
    await clearPersistence(pool);
    const repository = new FilingLineageRepository(pool);
    for (const number of [A0, A1, A2]) await repository.persistReceipt(receipt(number));
    await repository.persistVerifiedCorrectionRelation(relation(A1, A0));
    const before = await repository.persistVerifiedCorrectionRelation(relation(A2, A1));
    await assert.rejects(
      repository.persistVerifiedCorrectionRelation(relation(A0, A2)),
      lineageError('FILING_CORRECTION_CYCLE'),
    );
    const familyRow = await pool.query<{ revision: string }>(
      'SELECT revision::text FROM filing_intelligence.filing_report_family',
    );
    assert.equal(familyRow.rows[0]?.revision, before.familyRevision);
    assert.deepEqual(await counts(pool), { receipts: 3, families: 1, members: 3, relations: 2 });
  });

  await t.test('out-of-order receipts converge to the same verified graph', async () => {
    await clearPersistence(pool);
    const repository = new FilingLineageRepository(pool);
    for (const number of [A2, A0, A1]) await repository.persistReceipt(receipt(number));
    await repository.persistVerifiedCorrectionRelation(relation(A1, A0));
    await repository.persistVerifiedCorrectionRelation(relation(A2, A1));
    const graph = await pool.query<{ correction: string; corrected: string }>(
      `SELECT correction.receipt_number AS correction,
              corrected.receipt_number AS corrected
       FROM filing_intelligence.filing_correction_relation relation
       JOIN filing_intelligence.filing_receipt correction
         ON correction.id = relation.correction_receipt_id
       JOIN filing_intelligence.filing_receipt corrected
         ON corrected.id = relation.corrects_receipt_id
       ORDER BY correction.receipt_number`,
    );
    assert.deepEqual(graph.rows, [
      { correction: A1, corrected: A0 },
      { correction: A2, corrected: A1 },
    ]);
  });

  await t.test('concurrent family and edge persistence converges without duplicates', async () => {
    await clearPersistence(pool);
    const repository = new FilingLineageRepository(pool);
    for (const number of [A0, A1, A2]) await repository.persistReceipt(receipt(number));
    const families = await Promise.all([
      repository.persistVerifiedReportFamily(family()),
      repository.persistVerifiedReportFamily(family()),
    ]);
    assert.deepEqual(families.map(value => value.status).sort(), ['already_present', 'inserted']);
    const edges = await Promise.all([
      repository.persistVerifiedCorrectionRelation(relation(A1, A0)),
      repository.persistVerifiedCorrectionRelation(relation(A1, A0)),
    ]);
    assert.deepEqual(edges.map(value => value.status).sort(), ['already_present', 'inserted']);
    await Promise.all([
      repository.persistVerifiedCorrectionRelation(relation(A2, A1)),
      repository.persistVerifiedCorrectionRelation(relation(A2, A1)),
    ]);
    assert.deepEqual(await counts(pool), { receipts: 3, families: 1, members: 3, relations: 2 });

    await clearPersistence(pool);
    for (const number of [A0, A1, A2]) await repository.persistReceipt(receipt(number));
    const independent = await Promise.all([
      repository.persistVerifiedCorrectionRelation(relation(A1, A0)),
      repository.persistVerifiedCorrectionRelation(relation(A2, A1)),
    ]);
    assert.deepEqual(independent.map(value => value.status), ['inserted', 'inserted']);
    assert.deepEqual(await counts(pool), { receipts: 3, families: 1, members: 3, relations: 2 });

    await clearPersistence(pool);
    for (const number of [A0, A1, A2]) await repository.persistReceipt(receipt(number));
    const conflicting = await Promise.allSettled([
      repository.persistVerifiedCorrectionRelation(relation(A1, A0)),
      repository.persistVerifiedCorrectionRelation(relation(A1, A2)),
    ]);
    assert.equal(conflicting.filter(value => value.status === 'fulfilled').length, 1);
    const conflict = conflicting.find(value => value.status === 'rejected');
    assert.ok(conflict?.status === 'rejected');
    assert.equal(lineageError('FILING_CORRECTION_RELATION_CONFLICT')(conflict.reason), true);
    assert.equal((await counts(pool)).relations, 1);

    await clearPersistence(pool);
    for (const number of [A0, A1, A2]) await repository.persistReceipt(receipt(number));
    await repository.persistVerifiedCorrectionRelation(relation(A1, A0));
    const cycleRace = await Promise.allSettled([
      repository.persistVerifiedCorrectionRelation(relation(A2, A1)),
      repository.persistVerifiedCorrectionRelation(relation(A0, A2)),
    ]);
    assert.equal(cycleRace.filter(value => value.status === 'fulfilled').length, 1);
    const cycleConflict = cycleRace.find(value => value.status === 'rejected');
    assert.ok(cycleConflict?.status === 'rejected');
    assert.equal(lineageError('FILING_CORRECTION_CYCLE')(cycleConflict.reason), true);
    const cycle = await pool.query<{ has_cycle: boolean }>(
      `WITH RECURSIVE paths(origin, receipt_id, visited, has_cycle) AS (
         SELECT correction_receipt_id, corrects_receipt_id,
                ARRAY[correction_receipt_id, corrects_receipt_id], false
         FROM filing_intelligence.filing_correction_relation
         UNION ALL
         SELECT paths.origin, relation.corrects_receipt_id,
                paths.visited || relation.corrects_receipt_id,
                relation.corrects_receipt_id = ANY(paths.visited)
         FROM paths
         JOIN filing_intelligence.filing_correction_relation relation
           ON relation.correction_receipt_id = paths.receipt_id
         WHERE NOT paths.has_cycle
       ) SELECT coalesce(bool_or(has_cycle), false) AS has_cycle FROM paths`,
    );
    assert.equal(cycle.rows[0]?.has_cycle, false);
    assert.equal((await counts(pool)).relations, 2);
  });

  await t.test('withdrawal is receipt-only and leaves retrieval flags unchanged', async () => {
    await clearPersistence(pool);
    const documents = new FilingDocumentRepository(pool);
    const input = syntheticPersistenceInputFor({
      receiptNumber: A3, ...COMPANY_A, companyName: 'SYNTHETIC COMPANY A',
    });
    const persisted = await documents.persistCanonicalFiling({
      ...input,
      metadata: {
        ...input.metadata,
        isWithdrawn: true,
        correctionType: 'content-correction',
        metadataObservedAt: '2099-01-05T00:00:00.000Z',
      },
    });
    const row = await pool.query<{
      legal_status: string; lineage_status: string;
      is_retrieval_ready: boolean; is_current_effective: boolean; activated_at: Date | null;
    }>(`SELECT receipt.legal_status, receipt.lineage_status,
              document.is_retrieval_ready, document.is_current_effective, document.activated_at
       FROM filing_intelligence.filing_document document
       JOIN filing_intelligence.filing_receipt receipt ON receipt.id = document.receipt_id
       WHERE document.id = $1`, [persisted.documentId]);
    assert.deepEqual(row.rows[0], {
      legal_status: 'withdrawn', lineage_status: 'unresolved',
      is_retrieval_ready: false, is_current_effective: false, activated_at: null,
    });
    assert.deepEqual(await counts(pool), { receipts: 1, families: 0, members: 0, relations: 0 });
  });

  await t.test('bounded multi-family smoke persists linear graphs without duplicates', async () => {
    await clearPersistence(pool);
    const repository = new FilingLineageRepository(pool);
    const familyCount = 20;
    const receiptsPerFamily = 6;
    const receiptNumber = (familyIndex: number, memberIndex: number) =>
      `209902${String(familyIndex).padStart(2, '0')}${String(memberIndex).padStart(6, '0')}`;

    await Promise.all(Array.from({ length: familyCount * receiptsPerFamily }, (_, index) => {
      const familyIndex = Math.floor(index / receiptsPerFamily);
      const memberIndex = index % receiptsPerFamily;
      return repository.persistReceipt(receipt(receiptNumber(familyIndex, memberIndex)));
    }));
    await Promise.all(Array.from({ length: familyCount }, async (_, familyIndex) => {
      const root = receiptNumber(familyIndex, 0);
      const familyInput = { ...family(), lineageRootReceiptNumber: root };
      for (let memberIndex = 1; memberIndex < receiptsPerFamily; memberIndex += 1) {
        await repository.persistVerifiedCorrectionRelation({
          ...familyInput,
          correctionReceiptNumber: receiptNumber(familyIndex, memberIndex),
          correctsReceiptNumber: receiptNumber(familyIndex, memberIndex - 1),
          relationType: 'corrects',
          relationSource: 'trusted_backfill',
          relationReferenceHash: HASH,
          verifiedAt: VERIFIED_AT,
        });
      }
    }));
    assert.deepEqual(await counts(pool), {
      receipts: familyCount * receiptsPerFamily,
      families: familyCount,
      members: familyCount * receiptsPerFamily,
      relations: familyCount * (receiptsPerFamily - 1),
    });
  });
});
