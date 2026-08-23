import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { FilingRetrievalActivationError } from '../src/filingIntelligence/activation/errors.js';
import { FilingRetrievalActivationRepository } from '../src/filingIntelligence/activation/filingRetrievalActivationRepository.js';
import { FilingRetrievalActivationService } from '../src/filingIntelligence/activation/filingRetrievalActivationService.js';
import { FilingEligibilityRepository } from '../src/filingIntelligence/eligibility/filingEligibilityRepository.js';
import { FILING_RETRIEVAL_POLICY } from '../src/filingIntelligence/eligibility/policies.js';
import { FilingLexicalRepository } from '../src/filingIntelligence/lexical/filingLexicalRepository.js';
import { FilingLineageRepository } from '../src/filingIntelligence/lineage/filingLineageRepository.js';
import { FilingDocumentRepository } from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { FilingResolutionControlRepository } from '../src/filingIntelligence/resolution/controlRepository.js';
import { ResolveFamilyInput } from '../src/filingIntelligence/resolution/contracts.js';
import { VerifiedFilingGraphRepository } from '../src/filingIntelligence/resolution/graphRepository.js';
import { FilingResolutionService } from '../src/filingIntelligence/resolution/service.js';
import { clearPersistence, requiredTestDatabaseUrl, runMigrations } from './helpers/database.js';
import { syntheticPersistenceInputFor } from './helpers/filingFixture.js';

const ROOT = '20990401000000';
const CORRECTION = '20990401000001';
const BRANCH = '20990401000002';
const COMPANY = { corpCode: '55555555', symbol: '555555' };
const HASH = 'd'.repeat(64);

function metadata(receiptNumber: string, legalStatus = 'reported_active' as const) {
  return {
    provider: 'opendart-fss' as const, receiptNumber, ...COMPANY,
    companyName: 'ACTIVATION COMPANY', reportName: '합성 사업보고서', reportCode: '11011',
    filingDate: '2099-01-01', legalStatus,
    metadataSource: 'activation-integration-test',
    metadataObservedAt: '2099-04-01T00:00:00.000Z',
  };
}

function family() {
  return {
    provider: 'opendart-fss' as const, ...COMPANY, lineageRootReceiptNumber: ROOT,
    verificationSource: 'trusted_backfill' as const, verificationReferenceHash: HASH,
  };
}

function resolveInput() {
  return { provider: 'opendart-fss' as const, ...COMPANY, lineageRootReceiptNumber: ROOT };
}

function activationError(code: FilingRetrievalActivationError['code']) {
  return (value: unknown) => value instanceof FilingRetrievalActivationError && value.code === code;
}

function services(pool: Pool) {
  const graphs = new VerifiedFilingGraphRepository(pool);
  return {
    resolver: new FilingResolutionService(graphs),
    activation: new FilingRetrievalActivationService(
      new FilingRetrievalActivationRepository(pool), graphs, new FilingEligibilityRepository(pool),
    ),
  };
}

async function persistDocument(pool: Pool, receiptNumber: string, text: string, index = true) {
  await new FilingLineageRepository(pool).persistReceipt(metadata(receiptNumber));
  const document = await new FilingDocumentRepository(pool).persistCanonicalFiling(
    syntheticPersistenceInputFor({
      receiptNumber, ...COMPANY, companyName: 'ACTIVATION COMPANY',
      paragraphTexts: [text, `${text} 추가 근거`],
    }),
  );
  if (index) await new FilingLexicalRepository(pool).indexFilingDocumentLexically(document.documentId);
  return document;
}

async function prepareRoot(pool: Pool, index = true) {
  const document = await persistDocument(pool, ROOT, '최초 활성화 문서', index);
  const reportFamily = await new FilingLineageRepository(pool).persistVerifiedReportFamily(family());
  return { document, familyId: reportFamily.familyId };
}

async function addCorrection(pool: Pool, index = true) {
  const document = await persistDocument(pool, CORRECTION, '정정 활성화 문서', index);
  await new FilingLineageRepository(pool).persistVerifiedCorrectionRelation({
    ...family(), correctionReceiptNumber: CORRECTION, correctsReceiptNumber: ROOT,
    relationType: 'corrects', relationSource: 'trusted_backfill',
    relationReferenceHash: HASH, verifiedAt: '2099-04-02T00:00:00.000Z',
  });
  return document;
}

async function applyFresh(pool: Pool) {
  const current = services(pool);
  const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(resolveInput());
  return current.activation.apply({
    resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  });
}

async function counts(pool: Pool, familyId: string) {
  const result = await pool.query<{
    status: string; document_id: string | null; activation_revision: string;
    history_count: number; max_revision: string;
  }>(
    `SELECT activation.status, activation.document_id::text,
            activation.activation_revision::text,
            (SELECT count(*)::integer
             FROM filing_intelligence.filing_retrieval_activation_history AS history
             WHERE history.family_id = activation.family_id
               AND history.retrieval_policy_id = activation.retrieval_policy_id) AS history_count,
            (SELECT max(history.activation_revision)::text
             FROM filing_intelligence.filing_retrieval_activation_history AS history
             WHERE history.family_id = activation.family_id
               AND history.retrieval_policy_id = activation.retrieval_policy_id) AS max_revision
     FROM filing_intelligence.filing_retrieval_activation AS activation
     WHERE activation.family_id = $1 AND activation.retrieval_policy_id = $2`,
    [familyId, FILING_RETRIEVAL_POLICY.policyId],
  );
  return result.rows[0];
}

test('filing retrieval activation PostgreSQL integration', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({
    connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 2_000,
    statement_timeout: 30_000, application_name: 'alpha-twin-activation-integration-test',
  });
  t.after(async () => pool.end());

  await t.test('migration up, down, and re-up preserve eligibility and enforce constraints', async () => {
    await runMigrations('up', databaseUrl);
    const exists = async (name: string) => (await pool.query<{ value: string | null }>(
      'SELECT to_regclass($1)::text AS value', [name],
    )).rows[0]?.value != null;
    assert.equal(await exists('filing_intelligence.filing_retrieval_activation'), true);
    assert.equal(await exists('filing_intelligence.filing_retrieval_activation_history'), true);
    await runMigrations('down', databaseUrl);
    assert.equal(await exists('filing_intelligence.filing_retrieval_activation'), false);
    assert.equal(await exists('filing_intelligence.filing_retrieval_eligibility'), true);
    await runMigrations('up', databaseUrl);
    const constraints = await pool.query<{ constraint_name: string; delete_rule: string | null }>(
      `SELECT constraints.constraint_name, referential.delete_rule
       FROM information_schema.table_constraints AS constraints
       LEFT JOIN information_schema.referential_constraints AS referential
         ON referential.constraint_schema = constraints.constraint_schema
        AND referential.constraint_name = constraints.constraint_name
       WHERE constraints.table_schema = 'filing_intelligence'
         AND constraints.table_name IN (
           'filing_retrieval_activation', 'filing_retrieval_activation_history'
         )`,
    );
    const names = new Set(constraints.rows.map(row => row.constraint_name));
    for (const name of [
      'filing_retrieval_activation_pkey', 'filing_retrieval_activation_state_check',
      'filing_retrieval_activation_family_receipt_fk',
      'filing_retrieval_activation_document_receipt_fk',
      'filing_retrieval_activation_eligibility_fk',
      'filing_retrieval_activation_history_revision_unique',
    ]) assert.equal(names.has(name), true, name);
    assert.equal(constraints.rows.filter(row => row.delete_rule != null)
      .every(row => row.delete_rule === 'RESTRICT' || row.delete_rule === 'NO ACTION'), true);
  });

  await t.test('initial activation is atomic, timestamp-aligned, and idempotent', async () => {
    await clearPersistence(pool);
    const { document, familyId } = await prepareRoot(pool);
    const first = await applyFresh(pool);
    assert.deepEqual([first.status, first.activation?.documentId,
      first.activation?.activationRevision], ['activated', document.documentId, '1']);
    const row = await counts(pool, familyId);
    assert.deepEqual(row, {
      status: 'active', document_id: document.documentId, activation_revision: '1',
      history_count: 1, max_revision: '1',
    });
    const timestamps = await pool.query<{
      activated_at: Date; state_changed_at: Date; occurred_at: Date;
    }>(
      `SELECT activation.activated_at, activation.state_changed_at, history.occurred_at
       FROM filing_intelligence.filing_retrieval_activation AS activation
       JOIN filing_intelligence.filing_retrieval_activation_history AS history
         USING (family_id, retrieval_policy_id)
       WHERE activation.family_id = $1`, [familyId],
    );
    assert.equal(timestamps.rows[0]?.activated_at.getTime(),
      timestamps.rows[0]?.state_changed_at.getTime());
    assert.equal(timestamps.rows[0]?.state_changed_at.getTime(),
      timestamps.rows[0]?.occurred_at.getTime());
    const before = first.activation;
    const repeated = await applyFresh(pool);
    assert.equal(repeated.status, 'already_current');
    assert.equal(repeated.activation.updatedAt.getTime(), before?.updatedAt.getTime());
    assert.equal((await counts(pool, familyId))?.history_count, 1);
    const flags = await pool.query(
      `SELECT is_current_effective, is_retrieval_ready, activated_at
       FROM filing_intelligence.filing_document WHERE id = $1`, [document.documentId],
    );
    assert.deepEqual(flags.rows[0], {
      is_current_effective: false, is_retrieval_ready: false, activated_at: null,
    });
  });

  await t.test('a verified correction switches atomically and not-ready retains old active', async () => {
    await clearPersistence(pool);
    const root = await prepareRoot(pool);
    await applyFresh(pool);
    const correction = await addCorrection(pool);
    const switched = await applyFresh(pool);
    assert.ok(switched.activation);
    assert.deepEqual([switched.status, switched.activation.documentId,
      switched.activation.activationRevision], ['switched', correction.documentId, '2']);
    assert.deepEqual(await counts(pool, root.familyId), {
      status: 'active', document_id: correction.documentId, activation_revision: '2',
      history_count: 2, max_revision: '2',
    });

    await clearPersistence(pool);
    const retainedRoot = await prepareRoot(pool);
    await applyFresh(pool);
    await addCorrection(pool, false);
    const retained = await applyFresh(pool);
    assert.equal(retained.status, 'candidate_not_ready');
    assert.equal(retained.activation?.documentId, retainedRoot.document.documentId);
    assert.equal((await counts(pool, retainedRoot.familyId))?.activation_revision, '1');
  });

  await t.test('manual hold and terminal legal ineligibility deactivate without fallback', async () => {
    await clearPersistence(pool);
    const { familyId } = await prepareRoot(pool);
    await applyFresh(pool);
    await new FilingResolutionControlRepository(pool).setHold({
      familyId, expectedRevision: null, reasonCode: 'emergency_hold',
      referenceHash: HASH, expiresAt: '2099-05-01T00:00:00.000Z',
    });
    const held = await applyFresh(pool);
    assert.ok(held.activation);
    assert.deepEqual([held.status, held.activation.status,
      held.activation.activationRevision], ['deactivated', 'inactive', '2']);
    assert.equal(held.activation.documentId, null);

    await clearPersistence(pool);
    const legal = await prepareRoot(pool);
    await applyFresh(pool);
    await pool.query(
      `UPDATE filing_intelligence.filing_receipt
       SET legal_status = 'withdrawn' WHERE receipt_number = $1`, [ROOT],
    );
    const deactivated = await applyFresh(pool);
    assert.ok(deactivated.activation);
    assert.deepEqual([deactivated.status, deactivated.activation.status,
      deactivated.activation.activationRevision], ['deactivated', 'inactive', '2']);
    assert.equal((await counts(pool, legal.familyId))?.history_count, 2);
  });

  await t.test('stale graph and stale manual control fail before eligibility writes', async () => {
    await clearPersistence(pool);
    await prepareRoot(pool);
    const current = services(pool);
    const stale = await current.resolver.resolveCurrentEffectiveReceiptCandidate(resolveInput());
    await addCorrection(pool, false);
    await assert.rejects(current.activation.apply({
      resolution: stale, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    }), activationError('FILING_ACTIVATION_STALE_RESOLUTION'));
    assert.equal((await pool.query(
      'SELECT count(*)::integer AS count FROM filing_intelligence.filing_retrieval_activation',
    )).rows[0]?.count, 0);

    await clearPersistence(pool);
    const { familyId } = await prepareRoot(pool);
    const automatic = await current.resolver.resolveCurrentEffectiveReceiptCandidate(resolveInput());
    await new FilingResolutionControlRepository(pool).setHold({
      familyId, expectedRevision: null, reasonCode: 'emergency_hold', referenceHash: HASH,
      expiresAt: '2099-05-01T00:00:00.000Z',
    });
    await assert.rejects(current.activation.apply({
      resolution: automatic, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    }), activationError('FILING_ACTIVATION_STALE_RESOLUTION'));
    assert.equal((await pool.query(
      'SELECT count(*)::integer AS count FROM filing_intelligence.filing_retrieval_activation',
    )).rows[0]?.count, 0);
  });

  await t.test('multiple eligible representations fail closed without pointer/history writes', async () => {
    await clearPersistence(pool);
    await prepareRoot(pool);
    await persistDocument(pool, ROOT, '동일 접수의 두 번째 표현');
    const current = services(pool);
    const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(resolveInput());
    await assert.rejects(current.activation.apply({
      resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    }), activationError('FILING_ACTIVATION_REPRESENTATION_AMBIGUOUS'));
    const writes = await pool.query<{ activation_count: number; history_count: number }>(
      `SELECT
         (SELECT count(*)::integer FROM filing_intelligence.filing_retrieval_activation)
           AS activation_count,
         (SELECT count(*)::integer FROM filing_intelligence.filing_retrieval_activation_history)
           AS history_count`,
    );
    assert.deepEqual(writes.rows[0], { activation_count: 0, history_count: 0 });
  });

  await t.test('same receipt can switch representation and refresh changed eligibility provenance',
    async () => {
      await clearPersistence(pool);
      const first = await prepareRoot(pool);
      const initial = await applyFresh(pool);
      assert.ok(initial.activation);
      const second = await persistDocument(pool, ROOT, '새 immutable 표현');
      await pool.query(
        `UPDATE filing_intelligence.filing_lexical_generation
         SET status = 'failed' WHERE document_id = $1`, [first.document.documentId],
      );
      const switched = await applyFresh(pool);
      assert.ok(switched.activation);
      assert.deepEqual([switched.status, switched.activation.receiptId,
        switched.activation.documentId], ['switched', initial.activation.receiptId, second.documentId]);

      await clearPersistence(pool);
      const refresh = await prepareRoot(pool);
      const active = await applyFresh(pool);
      assert.ok(active.activation);
      await pool.query(
        `UPDATE filing_intelligence.filing_lexical_generation
         SET status = 'failed' WHERE document_id = $1`, [refresh.document.documentId],
      );
      assert.equal((await applyFresh(pool)).status, 'candidate_not_ready');
      await pool.query(
        `UPDATE filing_intelligence.filing_lexical_generation
         SET status = 'ready' WHERE document_id = $1`, [refresh.document.documentId],
      );
      const refreshed = await applyFresh(pool);
      assert.ok(refreshed.activation);
      assert.deepEqual([refreshed.status, refreshed.activation.documentId,
        refreshed.activation.activationRevision], ['refreshed', refresh.document.documentId, '2']);
      assert.equal(refreshed.activation.activatedAt?.getTime(), active.activation.activatedAt?.getTime());
    });

  await t.test('ambiguous, legal-unknown, and lineage-ineligible states retain old active', async () => {
    await clearPersistence(pool);
    const root = await prepareRoot(pool);
    await applyFresh(pool);
    const lineage = new FilingLineageRepository(pool);
    for (const receiptNumber of [CORRECTION, BRANCH]) {
      await lineage.persistReceipt(metadata(receiptNumber));
      await lineage.persistVerifiedCorrectionRelation({
        ...family(), correctionReceiptNumber: receiptNumber, correctsReceiptNumber: ROOT,
        relationType: 'corrects', relationSource: 'trusted_backfill',
        relationReferenceHash: HASH, verifiedAt: '2099-04-02T00:00:00.000Z',
      });
    }
    const branch = await applyFresh(pool);
    assert.deepEqual([branch.status, branch.activation?.documentId],
      ['retained_existing', root.document.documentId]);
    assert.equal((await counts(pool, root.familyId))?.history_count, 1);

    await clearPersistence(pool);
    const legal = await prepareRoot(pool);
    await applyFresh(pool);
    await pool.query(
      `UPDATE filing_intelligence.filing_receipt
       SET legal_status = 'unknown' WHERE receipt_number = $1`, [ROOT],
    );
    assert.deepEqual([(await applyFresh(pool)).status,
      (await counts(pool, legal.familyId))?.activation_revision], ['retained_existing', '1']);

    await pool.query(
      `UPDATE filing_intelligence.filing_receipt
       SET legal_status = 'reported_active', lineage_status = 'conflicted'
       WHERE receipt_number = $1`, [ROOT],
    );
    assert.deepEqual([(await applyFresh(pool)).status,
      (await counts(pool, legal.familyId))?.history_count], ['retained_existing', 1]);
  });

  await t.test('standalone eligibility and activation preserve document-generation lock order',
    async () => {
      await clearPersistence(pool);
      const root = await prepareRoot(pool);
      const current = services(pool);
      const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(resolveInput());
      const eligibility = new FilingEligibilityRepository(pool);
      const [activation, evaluated] = await Promise.all([
        current.activation.apply({
          resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
        }),
        eligibility.evaluateDocumentEligibility(
          root.document.documentId, FILING_RETRIEVAL_POLICY.policyId,
        ),
      ]);
      assert.equal(activation.status, 'activated');
      assert.equal(evaluated.status, 'eligible');
      assert.equal((await counts(pool, root.familyId))?.history_count, 1);
    });

  await t.test('stored activation fingerprint corruption is rejected without repair', async () => {
    await clearPersistence(pool);
    const { familyId } = await prepareRoot(pool);
    await applyFresh(pool);
    await pool.query(
      `UPDATE filing_intelligence.filing_retrieval_activation
       SET activation_fingerprint = repeat('f', 64) WHERE family_id = $1`, [familyId],
    );
    await assert.rejects(applyFresh(pool),
      activationError('FILING_ACTIVATION_INTEGRITY_FAILURE'));
    const row = await counts(pool, familyId);
    assert.deepEqual([row?.activation_revision, row?.history_count], ['1', 1]);
  });

  await t.test('concurrent identical activation serializes to one history transition', async () => {
    await clearPersistence(pool);
    const { familyId } = await prepareRoot(pool);
    const current = services(pool);
    const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(resolveInput());
    const results = await Promise.all([
      current.activation.apply({ resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId }),
      current.activation.apply({ resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId }),
    ]);
    assert.deepEqual(results.map(item => item.status).sort(), ['activated', 'already_current']);
    assert.deepEqual(await counts(pool, familyId), {
      status: 'active', document_id: results[0]!.activation!.documentId,
      activation_revision: '1', history_count: 1, max_revision: '1',
    });
  });

  await t.test('correction and hold mutations serialize behind activation family lock', async () => {
    const deferred = () => {
      let release!: () => void;
      let entered!: () => void;
      const wait = new Promise<void>(resolve => { release = resolve; });
      const seen = new Promise<void>(resolve => { entered = resolve; });
      return { wait, seen, release, entered };
    };

    await clearPersistence(pool);
    const root = await prepareRoot(pool);
    await persistDocument(pool, CORRECTION, '경쟁 조건 정정 문서');
    const baseline = services(pool);
    const rootResolution = await baseline.resolver
      .resolveCurrentEffectiveReceiptCandidate(resolveInput());
    const correctionGate = deferred();
    const correctionGraphs = new VerifiedFilingGraphRepository(pool, {
      afterFamilyRead: async () => {
        correctionGate.entered();
        await correctionGate.wait;
      },
    });
    const correctionActivation = new FilingRetrievalActivationService(
      new FilingRetrievalActivationRepository(pool), correctionGraphs,
      new FilingEligibilityRepository(pool),
    );
    const applying = correctionActivation.apply({
      resolution: rootResolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    });
    await correctionGate.seen;
    const relationWrite = new FilingLineageRepository(pool).persistVerifiedCorrectionRelation({
      ...family(), correctionReceiptNumber: CORRECTION, correctsReceiptNumber: ROOT,
      relationType: 'corrects', relationSource: 'trusted_backfill',
      relationReferenceHash: HASH, verifiedAt: '2099-04-02T00:00:00.000Z',
    });
    correctionGate.release();
    assert.equal((await applying).status, 'activated');
    await relationWrite;
    assert.equal((await applyFresh(pool)).status, 'switched');
    assert.equal((await counts(pool, root.familyId))?.activation_revision, '2');

    await clearPersistence(pool);
    const holdRoot = await prepareRoot(pool);
    const automatic = await baseline.resolver.resolveCurrentEffectiveReceiptCandidate(resolveInput());
    const holdGate = deferred();
    const holdGraphs = new VerifiedFilingGraphRepository(pool, {
      afterFamilyRead: async () => {
        holdGate.entered();
        await holdGate.wait;
      },
    });
    const holdActivation = new FilingRetrievalActivationService(
      new FilingRetrievalActivationRepository(pool), holdGraphs,
      new FilingEligibilityRepository(pool),
    );
    const activating = holdActivation.apply({
      resolution: automatic, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    });
    await holdGate.seen;
    const holdWrite = new FilingResolutionControlRepository(pool).setHold({
      familyId: holdRoot.familyId, expectedRevision: null, reasonCode: 'emergency_hold',
      referenceHash: HASH, expiresAt: '2099-05-01T00:00:00.000Z',
    });
    holdGate.release();
    assert.equal((await activating).status, 'activated');
    await holdWrite;
    assert.equal((await applyFresh(pool)).status, 'deactivated');
    assert.equal((await counts(pool, holdRoot.familyId))?.activation_revision, '2');
  });

  await t.test('20-family bounded smoke remains family-scoped and repeat execution is write-free',
    async () => {
      await clearPersistence(pool);
      const persistence = new FilingDocumentRepository(pool);
      const lineage = new FilingLineageRepository(pool);
      const lexical = new FilingLexicalRepository(pool);
      const current = services(pool);
      const inputs: ResolveFamilyInput[] = [];
      for (let index = 0; index < 20; index += 1) {
        const suffix = String(index).padStart(2, '0');
        const company = {
          corpCode: `66${String(index).padStart(6, '0')}`,
          symbol: `66${String(index).padStart(4, '0')}`,
        };
        const receipts = [0, 1, 2].map(value => `209905${suffix}${String(value).padStart(6, '0')}`);
        for (const receiptNumber of receipts) {
          await lineage.persistReceipt({
            provider: 'opendart-fss', receiptNumber, ...company,
            companyName: `ACTIVATION SMOKE ${suffix}`, reportName: '합성 사업보고서',
            reportCode: '11011', filingDate: '2099-01-01', legalStatus: 'reported_active',
            metadataSource: 'activation-performance-smoke',
            metadataObservedAt: '2099-05-01T00:00:00.000Z',
          });
          const document = await persistence.persistCanonicalFiling(syntheticPersistenceInputFor({
            receiptNumber, ...company, companyName: `ACTIVATION SMOKE ${suffix}`,
            paragraphTexts: [`family ${suffix} receipt ${receiptNumber}`],
          }));
          if (receiptNumber === receipts[2]) {
            await lexical.indexFilingDocumentLexically(document.documentId);
          }
        }
        const familyInput = {
          provider: 'opendart-fss' as const, ...company,
          lineageRootReceiptNumber: receipts[0]!,
          verificationSource: 'trusted_backfill' as const,
          verificationReferenceHash: HASH,
        };
        await lineage.persistVerifiedCorrectionRelation({
          ...familyInput, correctionReceiptNumber: receipts[1]!,
          correctsReceiptNumber: receipts[0]!, relationType: 'corrects',
          relationSource: 'trusted_backfill', relationReferenceHash: HASH,
          verifiedAt: '2099-05-02T00:00:00.000Z',
        });
        await lineage.persistVerifiedCorrectionRelation({
          ...familyInput, correctionReceiptNumber: receipts[2]!,
          correctsReceiptNumber: receipts[1]!, relationType: 'corrects',
          relationSource: 'trusted_backfill', relationReferenceHash: HASH,
          verifiedAt: '2099-05-03T00:00:00.000Z',
        });
        inputs.push({
          provider: familyInput.provider, ...company,
          lineageRootReceiptNumber: familyInput.lineageRootReceiptNumber,
        });
      }
      const activate = async (input: (typeof inputs)[number]) => {
        const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(input);
        return current.activation.apply({
          resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
        });
      };
      const first = await Promise.all(inputs.map(activate));
      assert.equal(first.every(result => result.status === 'activated'), true);
      const second = await Promise.all(inputs.map(activate));
      assert.equal(second.every(result => result.status === 'already_current'), true);
      const totals = await pool.query<{ activations: number; history: number }>(
        `SELECT
           (SELECT count(*)::integer
            FROM filing_intelligence.filing_retrieval_activation) AS activations,
           (SELECT count(*)::integer
            FROM filing_intelligence.filing_retrieval_activation_history) AS history`,
      );
      assert.deepEqual(totals.rows[0], { activations: 20, history: 20 });
    });
});
