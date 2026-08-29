import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { FilingRetrievalActivationRepository } from '../src/filingIntelligence/activation/filingRetrievalActivationRepository.js';
import { FilingRetrievalActivationService } from '../src/filingIntelligence/activation/filingRetrievalActivationService.js';
import { FilingEligibilityRepository } from '../src/filingIntelligence/eligibility/filingEligibilityRepository.js';
import { FILING_RETRIEVAL_POLICY } from '../src/filingIntelligence/eligibility/policies.js';
import { LegacyFilingProjectionError } from '../src/filingIntelligence/legacyProjection/errors.js';
import { LegacyFilingProjectionRepository } from '../src/filingIntelligence/legacyProjection/legacyFilingProjectionRepository.js';
import { LegacyFilingProjectionService } from '../src/filingIntelligence/legacyProjection/legacyFilingProjectionService.js';
import { FilingLexicalRepository } from '../src/filingIntelligence/lexical/filingLexicalRepository.js';
import { FilingLineageRepository } from '../src/filingIntelligence/lineage/filingLineageRepository.js';
import { FilingDocumentRepository } from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { FilingResolutionControlRepository } from '../src/filingIntelligence/resolution/controlRepository.js';
import { VerifiedFilingGraphRepository } from '../src/filingIntelligence/resolution/graphRepository.js';
import { FilingResolutionService } from '../src/filingIntelligence/resolution/service.js';
import { clearPersistence, requiredTestDatabaseUrl, runMigrations } from './helpers/database.js';
import { syntheticPersistenceInputFor } from './helpers/filingFixture.js';

const COMPANY = { corpCode: '89898989', symbol: '898989' };
const HASH = '8'.repeat(64);

function familyInput(rootReceiptNumber: string) {
  return {
    provider: 'opendart-fss' as const, ...COMPANY, lineageRootReceiptNumber: rootReceiptNumber,
    verificationSource: 'trusted_backfill' as const, verificationReferenceHash: HASH,
  };
}

function resolutionInput(rootReceiptNumber: string) {
  return { provider: 'opendart-fss' as const, ...COMPANY, lineageRootReceiptNumber: rootReceiptNumber };
}

function receiptMetadata(receiptNumber: string) {
  return {
    provider: 'opendart-fss' as const, receiptNumber, ...COMPANY,
    companyName: 'LEGACY PROJECTION COMPANY', reportName: '합성 사업보고서', reportCode: '11011',
    filingDate: '2099-01-01', legalStatus: 'reported_active' as const,
    metadataSource: 'legacy-projection-integration-test',
    metadataObservedAt: '2099-10-01T00:00:00.000Z',
  };
}

function dependencies(pool: Pool) {
  const graphs = new VerifiedFilingGraphRepository(pool);
  return {
    resolver: new FilingResolutionService(graphs),
    activation: new FilingRetrievalActivationService(
      new FilingRetrievalActivationRepository(pool), graphs, new FilingEligibilityRepository(pool),
    ),
    projection: new LegacyFilingProjectionService(new LegacyFilingProjectionRepository(pool)),
  };
}

async function persistDocument(pool: Pool, receiptNumber: string, text: string) {
  await new FilingLineageRepository(pool).persistReceipt(receiptMetadata(receiptNumber));
  const document = await new FilingDocumentRepository(pool).persistCanonicalFiling(
    syntheticPersistenceInputFor({
      receiptNumber, ...COMPANY, companyName: 'LEGACY PROJECTION COMPANY',
      paragraphTexts: [text, `${text} 검증 근거`],
    }),
  );
  await new FilingLexicalRepository(pool).indexFilingDocumentLexically(document.documentId);
  return document;
}

async function persistFamily(pool: Pool, rootReceiptNumber: string, activate = true) {
  const document = await persistDocument(pool, rootReceiptNumber, `root ${rootReceiptNumber}`);
  const family = await new FilingLineageRepository(pool).persistVerifiedReportFamily(
    familyInput(rootReceiptNumber),
  );
  if (activate) await applyFresh(pool, rootReceiptNumber);
  return { document, familyId: family.familyId };
}

async function addCorrection(pool: Pool, rootReceiptNumber: string, correctionReceiptNumber: string) {
  const document = await persistDocument(
    pool, correctionReceiptNumber, `correction ${correctionReceiptNumber}`,
  );
  await new FilingLineageRepository(pool).persistVerifiedCorrectionRelation({
    ...familyInput(rootReceiptNumber), correctionReceiptNumber,
    correctsReceiptNumber: rootReceiptNumber, relationType: 'corrects',
    relationSource: 'trusted_backfill', relationReferenceHash: HASH,
    verifiedAt: '2099-10-02T00:00:00.000Z',
  });
  return document;
}

async function applyFresh(pool: Pool, rootReceiptNumber: string) {
  const current = dependencies(pool);
  const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(
    resolutionInput(rootReceiptNumber),
  );
  return current.activation.apply({
    resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  });
}

async function flags(pool: Pool, familyId: string) {
  return (await pool.query<{
    id: string; is_current_effective: boolean; is_retrieval_ready: boolean;
    activated_at: Date | null;
  }>(
    `SELECT document.id::text, document.is_current_effective,
            document.is_retrieval_ready, document.activated_at
     FROM filing_intelligence.filing_report_family_member AS member
     JOIN filing_intelligence.filing_document AS document ON document.receipt_id = member.receipt_id
     WHERE member.family_id = $1
     ORDER BY document.id`,
    [familyId],
  )).rows;
}

async function authoritySnapshot(pool: Pool, familyId: string) {
  return (await pool.query(
    `SELECT
       (SELECT jsonb_agg(to_jsonb(activation) ORDER BY activation.retrieval_policy_id)
        FROM filing_intelligence.filing_retrieval_activation AS activation
        WHERE activation.family_id = $1) AS activations,
       (SELECT jsonb_agg(to_jsonb(history) ORDER BY history.id)
        FROM filing_intelligence.filing_retrieval_activation_history AS history
        WHERE history.family_id = $1) AS history,
       (SELECT jsonb_agg(to_jsonb(eligibility) ORDER BY eligibility.document_id,
                                                    eligibility.retrieval_policy_id)
        FROM filing_intelligence.filing_retrieval_eligibility AS eligibility
        JOIN filing_intelligence.filing_document AS document
          ON document.id = eligibility.document_id
        JOIN filing_intelligence.filing_report_family_member AS member
          ON member.receipt_id = document.receipt_id
        WHERE member.family_id = $1) AS eligibility`,
    [familyId],
  )).rows[0];
}

function projectionError(code: LegacyFilingProjectionError['code']) {
  return (value: unknown) => value instanceof LegacyFilingProjectionError && value.code === code;
}

test('legacy filing projection PostgreSQL integration', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({
    connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 2_000,
    statement_timeout: 30_000, application_name: 'alpha-twin-legacy-projection-integration-test',
  });
  t.after(async () => pool.end());
  await runMigrations('up', databaseUrl);

  await t.test('active projection copies activation time and repeated reconciliation is write-free',
    async () => {
      await clearPersistence(pool);
      const root = await persistFamily(pool, '20991001000000');
      const beforeAuthority = await authoritySnapshot(pool, root.familyId);
      const activationTime = (await pool.query<{ activated_at: Date }>(
        `SELECT activated_at FROM filing_intelligence.filing_retrieval_activation
         WHERE family_id = $1 AND retrieval_policy_id = $2`,
        [root.familyId, FILING_RETRIEVAL_POLICY.policyId],
      )).rows[0]!.activated_at;
      const first = await dependencies(pool).projection.reconcileLegacyFilingProjection({
        familyId: root.familyId,
      });
      assert.deepEqual([first.status, first.activeDocumentId, first.updatedDocumentCount],
        ['updated', root.document.documentId, 1]);
      const projected = await flags(pool, root.familyId);
      assert.deepEqual(projected.map(row => [row.id, row.is_current_effective,
        row.is_retrieval_ready, row.activated_at?.getTime()]),
      [[root.document.documentId, true, true, activationTime.getTime()]]);
      const repeated = await dependencies(pool).projection.reconcileLegacyFilingProjection({
        familyId: root.familyId,
      });
      assert.deepEqual([repeated.status, repeated.updatedDocumentCount], ['already_current', 0]);
      assert.deepEqual(await authoritySnapshot(pool, root.familyId), beforeAuthority);
    });

  await t.test('activation repairs stale flags while other families and policies stay isolated',
    async () => {
      await clearPersistence(pool);
      const first = await persistFamily(pool, '20991002000000');
      const second = await persistFamily(pool, '20991002000001');
      const extra = await persistDocument(pool, '20991002000000', 'eligible inactive representation');
      await new FilingEligibilityRepository(pool).evaluateDocumentEligibility(
        extra.documentId, FILING_RETRIEVAL_POLICY.policyId,
      );
      await pool.query(
        `UPDATE filing_intelligence.filing_document
         SET is_current_effective = true, is_retrieval_ready = true, activated_at = now()
         WHERE id = $1`, [second.document.documentId],
      );
      await pool.query(
        `INSERT INTO filing_intelligence.filing_retrieval_eligibility
         SELECT document_id, receipt_id, 'future-test-policy', repeat('a', 64),
                representation_policy_id, representation_policy_fingerprint, status, reason_code,
                representation_fingerprint, lexical_generation_id, lexical_profile_id,
                lexical_schema_version, lexical_normalizer_version, lexical_text_search_config,
                lexical_generation_fingerprint, lexical_chunk_count, lexical_total_lexeme_count,
                repeat('b', 64), revision, evaluated_at, created_at, updated_at
         FROM filing_intelligence.filing_retrieval_eligibility
         WHERE document_id = $1 AND retrieval_policy_id = $2`,
        [extra.documentId, FILING_RETRIEVAL_POLICY.policyId],
      );
      await pool.query(
        `INSERT INTO filing_intelligence.filing_retrieval_activation
         SELECT family_id, 'future-test-policy', repeat('a', 64), status, receipt_id, $2::bigint,
                family_revision, family_fingerprint, resolution_fingerprint, resolver_id,
                resolver_version, manual_control_revision, selection_mode, eligibility_revision,
                repeat('b', 64), representation_policy_id, representation_policy_fingerprint,
                (SELECT representation_fingerprint
                 FROM filing_intelligence.filing_retrieval_eligibility
                 WHERE document_id = $2 AND retrieval_policy_id = 'future-test-policy'),
                (SELECT lexical_generation_id
                 FROM filing_intelligence.filing_retrieval_eligibility
                 WHERE document_id = $2 AND retrieval_policy_id = 'future-test-policy'),
                (SELECT lexical_generation_fingerprint
                 FROM filing_intelligence.filing_retrieval_eligibility
                 WHERE document_id = $2 AND retrieval_policy_id = 'future-test-policy'),
                activation_revision, repeat('c', 64), activated_at, state_changed_at,
                created_at, updated_at
         FROM filing_intelligence.filing_retrieval_activation
         WHERE family_id = $1 AND retrieval_policy_id = $3`,
        [first.familyId, extra.documentId, FILING_RETRIEVAL_POLICY.policyId],
      );
      const result = await dependencies(pool).projection.reconcileLegacyFilingProjection({
        familyId: first.familyId,
      });
      assert.equal(result.activeDocumentId, first.document.documentId);
      const firstFlags = await flags(pool, first.familyId);
      assert.deepEqual(firstFlags.map(row => [row.id, row.is_current_effective]),
        [[first.document.documentId, true], [extra.documentId, false]]);
      const secondFlags = await flags(pool, second.familyId);
      assert.deepEqual(secondFlags.map(row => [row.is_current_effective, row.is_retrieval_ready]),
        [[true, true]]);
    });

  await t.test('inactive and missing activation clear stale flags without creating authority rows',
    async () => {
      await clearPersistence(pool);
      const inactive = await persistFamily(pool, '20991003000000');
      await dependencies(pool).projection.reconcileLegacyFilingProjection({
        familyId: inactive.familyId,
      });
      await new FilingResolutionControlRepository(pool).setHold({
        familyId: inactive.familyId, expectedRevision: null, reasonCode: 'emergency_hold',
        referenceHash: HASH, expiresAt: '2099-11-01T00:00:00.000Z',
      });
      await applyFresh(pool, '20991003000000');
      const inactiveAuthority = await authoritySnapshot(pool, inactive.familyId);
      const cleared = await dependencies(pool).projection.reconcileLegacyFilingProjection({
        familyId: inactive.familyId,
      });
      assert.equal(cleared.status, 'cleared');
      assert.deepEqual((await flags(pool, inactive.familyId)).map(row => [
        row.is_current_effective, row.is_retrieval_ready, row.activated_at,
      ]), [[false, false, null]]);
      assert.deepEqual(await authoritySnapshot(pool, inactive.familyId), inactiveAuthority);

      const missing = await persistFamily(pool, '20991003000001', false);
      await pool.query(
        `UPDATE filing_intelligence.filing_document
         SET is_current_effective = true, is_retrieval_ready = true, activated_at = now()
         WHERE id = $1`, [missing.document.documentId],
      );
      const missingResult = await dependencies(pool).projection.reconcileLegacyFilingProjection({
        familyId: missing.familyId,
      });
      assert.deepEqual([missingResult.status, missingResult.activationRevision], ['cleared', null]);
      assert.equal((await pool.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM filing_intelligence.filing_retrieval_activation WHERE family_id = $1`,
        [missing.familyId],
      )).rows[0]!.count, 0);
    });

  await t.test('manual hold and legal withdrawal do not bypass activation authority', async () => {
    await clearPersistence(pool);
    const root = await persistFamily(pool, '20991004000000');
    await dependencies(pool).projection.reconcileLegacyFilingProjection({ familyId: root.familyId });
    await new FilingResolutionControlRepository(pool).setHold({
      familyId: root.familyId, expectedRevision: null, reasonCode: 'emergency_hold',
      referenceHash: HASH, expiresAt: '2099-11-01T00:00:00.000Z',
    });
    assert.equal((await dependencies(pool).projection.reconcileLegacyFilingProjection({
      familyId: root.familyId,
    })).status, 'already_current');
    await pool.query(
      `UPDATE filing_intelligence.filing_receipt
       SET legal_status = 'withdrawn' WHERE receipt_number = '20991004000000'`,
    );
    assert.equal((await dependencies(pool).projection.reconcileLegacyFilingProjection({
      familyId: root.familyId,
    })).status, 'already_current');
    assert.equal((await flags(pool, root.familyId))[0]?.is_current_effective, true);
  });

  await t.test('activation and eligibility corruption fail before any legacy write', async () => {
    const cases = [
      {
        code: 'FILING_LEGACY_PROJECTION_ACTIVATION_INTEGRITY_FAILURE' as const,
        sql: `UPDATE filing_intelligence.filing_retrieval_activation
              SET activation_fingerprint = repeat('0', 64) WHERE family_id = $1`,
      },
      {
        code: 'FILING_LEGACY_PROJECTION_ELIGIBILITY_STALE' as const,
        sql: `UPDATE filing_intelligence.filing_retrieval_eligibility
              SET revision = revision + 1 WHERE document_id = $1`,
      },
    ];
    for (const [index, failure] of cases.entries()) {
      await clearPersistence(pool);
      const root = await persistFamily(pool, `20991005${String(index).padStart(6, '0')}`);
      const before = await flags(pool, root.familyId);
      await pool.query(failure.sql, [index === 0 ? root.familyId : root.document.documentId]);
      await assert.rejects(dependencies(pool).projection.reconcileLegacyFilingProjection({
        familyId: root.familyId,
      }), projectionError(failure.code));
      assert.deepEqual(await flags(pool, root.familyId), before);
    }
  });

  await t.test('concurrent projections serialize to one repair and one no-op', async () => {
    await clearPersistence(pool);
    const root = await persistFamily(pool, '20991006000000');
    const results = await Promise.all([
      dependencies(pool).projection.reconcileLegacyFilingProjection({ familyId: root.familyId }),
      dependencies(pool).projection.reconcileLegacyFilingProjection({ familyId: root.familyId }),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), ['already_current', 'updated']);
    assert.deepEqual(results.map(result => result.updatedDocumentCount).sort(), [0, 1]);
  });

  await t.test('activation switch race cannot commit stale inversion and next projection converges',
    async () => {
      await clearPersistence(pool);
      const rootReceipt = '20991007000000';
      const root = await persistFamily(pool, rootReceipt);
      await dependencies(pool).projection.reconcileLegacyFilingProjection({ familyId: root.familyId });
      const correction = await addCorrection(pool, rootReceipt, '20991007000001');
      const current = dependencies(pool);
      const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(
        resolutionInput(rootReceipt),
      );
      await Promise.all([
        current.projection.reconcileLegacyFilingProjection({ familyId: root.familyId }),
        current.activation.apply({
          resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
        }),
      ]);
      const activation = (await pool.query<{ document_id: string }>(
        `SELECT document_id::text FROM filing_intelligence.filing_retrieval_activation
         WHERE family_id = $1 AND retrieval_policy_id = $2`,
        [root.familyId, FILING_RETRIEVAL_POLICY.policyId],
      )).rows[0]!.document_id;
      assert.equal(activation, correction.documentId);
      const converged = await current.projection.reconcileLegacyFilingProjection({
        familyId: root.familyId,
      });
      assert.equal(converged.activeDocumentId, correction.documentId);
      assert.deepEqual((await flags(pool, root.familyId)).map(row => [
        row.id, row.is_current_effective,
      ]), [[root.document.documentId, false], [correction.documentId, true]]);
    });

  await t.test('different families reconcile concurrently without cross-family writes', async () => {
    await clearPersistence(pool);
    const first = await persistFamily(pool, '20991007500000');
    const second = await persistFamily(pool, '20991007500001');
    const [firstResult, secondResult] = await Promise.all([
      dependencies(pool).projection.reconcileLegacyFilingProjection({ familyId: first.familyId }),
      dependencies(pool).projection.reconcileLegacyFilingProjection({ familyId: second.familyId }),
    ]);
    assert.deepEqual([firstResult.status, secondResult.status], ['updated', 'updated']);
    assert.deepEqual((await flags(pool, first.familyId)).map(row => [
      row.id, row.is_current_effective,
    ]), [[first.document.documentId, true]]);
    assert.deepEqual((await flags(pool, second.familyId)).map(row => [
      row.id, row.is_current_effective,
    ]), [[second.document.documentId, true]]);
  });

  await t.test('twenty representations remain family-scoped across 200 write-free reconciliations',
    async () => {
      await clearPersistence(pool);
      const receipt = '20991008000000';
      const root = await persistFamily(pool, receipt);
      for (let index = 1; index < 20; index += 1) {
        await persistDocument(pool, receipt, `representation ${index}`);
      }
      const repaired = await dependencies(pool).projection.reconcileLegacyFilingProjection({
        familyId: root.familyId,
      });
      assert.equal(repaired.updatedDocumentCount, 1);
      for (let index = 0; index < 200; index += 1) {
        const result = await dependencies(pool).projection.reconcileLegacyFilingProjection({
          familyId: root.familyId,
        });
        assert.deepEqual([result.status, result.updatedDocumentCount], ['already_current', 0]);
      }
      const projected = await flags(pool, root.familyId);
      assert.equal(projected.length, 20);
      assert.deepEqual(projected.filter(row => row.is_current_effective)
        .map(row => row.id), [root.document.documentId]);
      assert.equal(projected.filter(row => row.is_retrieval_ready).length, 1);
    });
});
