import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { ActiveFilingScopeError } from '../src/filingIntelligence/activeScope/errors.js';
import { ActiveFilingScopeRepository } from '../src/filingIntelligence/activeScope/activeFilingScopeRepository.js';
import { ActiveFilingScopeService } from '../src/filingIntelligence/activeScope/activeFilingScopeService.js';
import { FilingRetrievalActivationRepository } from '../src/filingIntelligence/activation/filingRetrievalActivationRepository.js';
import { FilingRetrievalActivationService } from '../src/filingIntelligence/activation/filingRetrievalActivationService.js';
import { FilingEligibilityRepository } from '../src/filingIntelligence/eligibility/filingEligibilityRepository.js';
import { FILING_RETRIEVAL_POLICY } from '../src/filingIntelligence/eligibility/policies.js';
import { FilingLexicalRepository } from '../src/filingIntelligence/lexical/filingLexicalRepository.js';
import { FilingLineageRepository } from '../src/filingIntelligence/lineage/filingLineageRepository.js';
import { FilingDocumentRepository } from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { FilingResolutionControlRepository } from '../src/filingIntelligence/resolution/controlRepository.js';
import { VerifiedFilingGraphRepository } from '../src/filingIntelligence/resolution/graphRepository.js';
import { FilingResolutionService } from '../src/filingIntelligence/resolution/service.js';
import { clearPersistence, requiredTestDatabaseUrl, runMigrations } from './helpers/database.js';
import { syntheticPersistenceInputFor } from './helpers/filingFixture.js';

const COMPANY = { corpCode: '77777777', symbol: '777777' };
const HASH = '7'.repeat(64);

function activeScopeError(code: ActiveFilingScopeError['code']) {
  return (value: unknown) => value instanceof ActiveFilingScopeError && value.code === code;
}

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
    companyName: 'ACTIVE SCOPE COMPANY', reportName: '합성 사업보고서', reportCode: '11011',
    filingDate: '2099-01-01', legalStatus: 'reported_active' as const,
    metadataSource: 'active-scope-integration-test',
    metadataObservedAt: '2099-08-01T00:00:00.000Z',
  };
}

function dependencies(pool: Pool) {
  const graphs = new VerifiedFilingGraphRepository(pool);
  return {
    resolver: new FilingResolutionService(graphs),
    activation: new FilingRetrievalActivationService(
      new FilingRetrievalActivationRepository(pool), graphs, new FilingEligibilityRepository(pool),
    ),
    scope: new ActiveFilingScopeService(new ActiveFilingScopeRepository(pool)),
  };
}

async function persistFamily(pool: Pool, rootReceiptNumber: string, activate = true) {
  const persistence = new FilingDocumentRepository(pool);
  await new FilingLineageRepository(pool).persistReceipt(receiptMetadata(rootReceiptNumber));
  const document = await persistence.persistCanonicalFiling(syntheticPersistenceInputFor({
    receiptNumber: rootReceiptNumber, ...COMPANY, companyName: 'ACTIVE SCOPE COMPANY',
    paragraphTexts: [`active scope ${rootReceiptNumber}`, '검증된 검색 근거'],
  }));
  await new FilingLexicalRepository(pool).indexFilingDocumentLexically(document.documentId);
  const family = await new FilingLineageRepository(pool).persistVerifiedReportFamily(
    familyInput(rootReceiptNumber),
  );
  if (activate) {
    const current = dependencies(pool);
    const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(
      resolutionInput(rootReceiptNumber),
    );
    const result = await current.activation.apply({
      resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    });
    assert.equal(result.status, 'activated');
  }
  return { document, familyId: family.familyId };
}

async function addCorrection(pool: Pool, rootReceiptNumber: string, correctionReceiptNumber: string) {
  const persistence = new FilingDocumentRepository(pool);
  await new FilingLineageRepository(pool).persistReceipt(receiptMetadata(correctionReceiptNumber));
  const document = await persistence.persistCanonicalFiling(syntheticPersistenceInputFor({
    receiptNumber: correctionReceiptNumber, ...COMPANY, companyName: 'ACTIVE SCOPE COMPANY',
    paragraphTexts: [`correction ${correctionReceiptNumber}`, '새 표현 준비 중'],
  }));
  await new FilingLexicalRepository(pool).indexFilingDocumentLexically(document.documentId);
  await new FilingLineageRepository(pool).persistVerifiedCorrectionRelation({
    ...familyInput(rootReceiptNumber), correctionReceiptNumber,
    correctsReceiptNumber: rootReceiptNumber, relationType: 'corrects',
    relationSource: 'trusted_backfill', relationReferenceHash: HASH,
    verifiedAt: '2099-08-01T00:00:00.000Z',
  });
  return document;
}

test('verified active filing scope PostgreSQL integration', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({
    connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 2_000,
    statement_timeout: 30_000, application_name: 'alpha-twin-active-scope-integration-test',
  });
  t.after(async () => pool.end());
  await runMigrations('up', databaseUrl);

  await t.test('empty, active, and inactive family scopes are normal read-only states', async () => {
    await clearPersistence(pool);
    const current = dependencies(pool);
    const emptyCompany = await current.scope.resolveCompany({
      ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    });
    assert.deepEqual([emptyCompany.status, emptyCompany.documentIds], ['empty', []]);

    const pending = await persistFamily(pool, '20990801000000', false);
    assert.equal((await current.scope.resolveFamily({
      familyId: pending.familyId, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    })).status, 'empty');

    const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(
      resolutionInput('20990801000000'),
    );
    await current.activation.apply({
      resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    });
    const active = await current.scope.resolveFamily({
      familyId: pending.familyId, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    });
    assert.deepEqual([active.status, active.documentIds], ['active', [pending.document.documentId]]);

    await new FilingResolutionControlRepository(pool).setHold({
      familyId: pending.familyId, expectedRevision: null, reasonCode: 'emergency_hold',
      referenceHash: HASH, expiresAt: '2099-09-01T00:00:00.000Z',
    });
    const freshHold = await current.resolver.resolveCurrentEffectiveReceiptCandidate(
      resolutionInput('20990801000000'),
    );
    await current.activation.apply({
      resolution: freshHold, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    });
    assert.equal((await current.scope.resolveFamily({
      familyId: pending.familyId, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    })).status, 'empty');
  });

  await t.test('valid company scope is deterministic and leaves every authoritative row unchanged',
    async () => {
      await clearPersistence(pool);
      const root = await persistFamily(pool, '20990802000000');
      const current = dependencies(pool);
      const before = await pool.query(
        `SELECT
           (SELECT row_to_json(activation) FROM filing_intelligence.filing_retrieval_activation activation) AS activation,
           (SELECT count(*)::integer FROM filing_intelligence.filing_retrieval_activation_history) AS history,
           (SELECT row_to_json(eligibility) FROM filing_intelligence.filing_retrieval_eligibility eligibility) AS eligibility,
           (SELECT row_to_json(manifest) FROM filing_intelligence.filing_document_representation_manifest manifest) AS manifest,
           (SELECT row_to_json(control) FROM filing_intelligence.filing_family_resolution_control control) AS control,
           (SELECT row_to_json(receipt) FROM filing_intelligence.filing_receipt receipt) AS receipt`,
      );
      const first = await current.scope.resolveCompany({
        ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      });
      const second = await current.scope.resolveCompany({
        ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      });
      assert.deepEqual(first.documentIds, [root.document.documentId]);
      assert.equal(first.scopeFingerprint, second.scopeFingerprint);
      assert.notEqual(first.resolvedAt, '');
      const after = await pool.query(before.command === 'SELECT'
        ? `SELECT
           (SELECT row_to_json(activation) FROM filing_intelligence.filing_retrieval_activation activation) AS activation,
           (SELECT count(*)::integer FROM filing_intelligence.filing_retrieval_activation_history) AS history,
           (SELECT row_to_json(eligibility) FROM filing_intelligence.filing_retrieval_eligibility eligibility) AS eligibility,
           (SELECT row_to_json(manifest) FROM filing_intelligence.filing_document_representation_manifest manifest) AS manifest,
           (SELECT row_to_json(control) FROM filing_intelligence.filing_family_resolution_control control) AS control,
           (SELECT row_to_json(receipt) FROM filing_intelligence.filing_receipt receipt) AS receipt`
        : 'SELECT 1');
      assert.deepEqual(after.rows, before.rows);
      const flags = await pool.query(
        `SELECT is_current_effective, is_retrieval_ready, activated_at
         FROM filing_intelligence.filing_document WHERE id = $1`, [root.document.documentId],
      );
      assert.deepEqual(flags.rows[0], {
        is_current_effective: false, is_retrieval_ready: false, activated_at: null,
      });
    });

  await t.test('manual hold is a DB-time veto while expired hold and manual select are not', async () => {
    await clearPersistence(pool);
    const root = await persistFamily(pool, '20990803000000');
    const current = dependencies(pool);
    await new FilingResolutionControlRepository(pool).setHold({
      familyId: root.familyId, expectedRevision: null, reasonCode: 'emergency_hold',
      referenceHash: HASH, expiresAt: '2099-09-01T00:00:00.000Z',
    });
    const held = await current.scope.resolveCompany({
      ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    });
    assert.deepEqual([held.status, held.documentIds, held.vetoes[0]?.reason],
      ['empty', [], 'manual_hold']);
    assert.equal((await pool.query(
      'SELECT status FROM filing_intelligence.filing_retrieval_activation WHERE family_id = $1',
      [root.familyId],
    )).rows[0]?.status, 'active');

    await pool.query(
      `UPDATE filing_intelligence.filing_family_resolution_control
       SET expires_at = '2000-01-01T00:00:00.000Z',
           control_fingerprint = encode(sha256(convert_to(concat('', control_fingerprint), 'UTF8')), 'hex')
       WHERE family_id = $1`, [root.familyId],
    );
    await assert.rejects(current.scope.resolveCompany({
      ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    }), activeScopeError('FILING_ACTIVE_SCOPE_OWNERSHIP_FAILURE'));
  });

  await t.test('expired hold and manual selection are allowed when control fingerprints are valid',
    async () => {
      await clearPersistence(pool);
      const expiredRoot = await persistFamily(pool, '20990804000000');
      const controls = new FilingResolutionControlRepository(pool);
      await controls.setHold({
        familyId: expiredRoot.familyId, expectedRevision: null, reasonCode: 'emergency_hold',
        referenceHash: HASH, expiresAt: '2000-01-01T00:00:00.000Z',
      });
      assert.equal((await dependencies(pool).scope.resolveFamily({
        familyId: expiredRoot.familyId, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      })).status, 'active');

      await clearPersistence(pool);
      const selectedRoot = await persistFamily(pool, '20990805000000');
      await new FilingResolutionControlRepository(pool).setManualSelection({
        familyId: selectedRoot.familyId, selectedReceiptId: (await pool.query<{ id: string }>(
          'SELECT id::text FROM filing_intelligence.filing_receipt WHERE receipt_number = $1',
          ['20990805000000'],
        )).rows[0]!.id, expectedRevision: null, reasonCode: 'manual_verified_selection',
        referenceHash: HASH,
      });
      assert.equal((await dependencies(pool).scope.resolveFamily({
        familyId: selectedRoot.familyId, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      })).status, 'active');
    });

  await t.test('all families share one database clock for hold vetoes and resolvedAt', async () => {
    await clearPersistence(pool);
    const held = await persistFamily(pool, '20990805500000');
    const expired = await persistFamily(pool, '20990805500001');
    const controls = new FilingResolutionControlRepository(pool);
    await controls.setHold({
      familyId: held.familyId, expectedRevision: null, reasonCode: 'emergency_hold',
      referenceHash: HASH, expiresAt: '2099-09-01T00:00:00.000Z',
    });
    await controls.setHold({
      familyId: expired.familyId, expectedRevision: null, reasonCode: 'emergency_hold',
      referenceHash: HASH, expiresAt: '2000-01-01T00:00:00.000Z',
    });
    const repository = new ActiveFilingScopeRepository(pool);
    let loadedRows: readonly Awaited<ReturnType<typeof repository.loadCompany>>[number][] = [];
    const capturingRepository = {
      loadFamily: repository.loadFamily.bind(repository),
      async loadCompany(corpCode: string, symbol: string, retrievalPolicyId: string) {
        loadedRows = await repository.loadCompany(corpCode, symbol, retrievalPolicyId);
        return loadedRows;
      },
    };
    const scope = await new ActiveFilingScopeService(capturingRepository).resolveCompany({
      ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    });
    assert.equal(loadedRows.length, 2);
    assert.equal(loadedRows[0]!.database_now.getTime(), loadedRows[1]!.database_now.getTime());
    assert.equal(scope.resolvedAt, loadedRows[0]!.database_now.toISOString());
    assert.equal(scope.entries.length, 1);
    assert.equal(scope.vetoes.length, 1);
    assert.equal(scope.entries[0]?.familyId, expired.familyId);
    assert.equal(scope.vetoes[0]?.familyId, held.familyId);
  });

  await t.test('withdrawn and cancelled veto, while unknown legal status remains active', async () => {
    for (const legalStatus of ['withdrawn', 'cancelled', 'unknown'] as const) {
      await clearPersistence(pool);
      const root = await persistFamily(pool, '20990806000000');
      await pool.query(
        'UPDATE filing_intelligence.filing_receipt SET legal_status = $2 WHERE receipt_number = $1',
        ['20990806000000', legalStatus],
      );
      const scope = await dependencies(pool).scope.resolveFamily({
        familyId: root.familyId, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      });
      assert.equal(scope.status, legalStatus === 'unknown' ? 'active' : 'vetoed');
      if (legalStatus !== 'unknown') assert.equal(scope.veto?.reason, `receipt_${legalStatus}`);
    }
  });

  await t.test('graph provenance changes retain old active but technical evidence staleness fails',
    async () => {
      await clearPersistence(pool);
      const rootReceipt = '20990807000000';
      const root = await persistFamily(pool, rootReceipt);
      await addCorrection(pool, rootReceipt, '20990807000001');
      const retained = await dependencies(pool).scope.resolveFamily({
        familyId: root.familyId, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      });
      assert.deepEqual([retained.status, retained.documentIds],
        ['active', [root.document.documentId]]);

      await pool.query(
        `UPDATE filing_intelligence.filing_lexical_generation
         SET status = 'failed' WHERE document_id = $1`, [root.document.documentId],
      );
      await new FilingEligibilityRepository(pool).evaluateDocumentEligibility(
        root.document.documentId, FILING_RETRIEVAL_POLICY.policyId,
      );
      await assert.rejects(dependencies(pool).scope.resolveCompany({
        ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      }), activeScopeError('FILING_ACTIVE_SCOPE_ELIGIBILITY_STALE'));
    });

  await t.test('activation corruption fails the whole company scope instead of returning partial data',
    async () => {
      await clearPersistence(pool);
      await persistFamily(pool, '20990808000000');
      const second = await persistFamily(pool, '20990808000001');
      await pool.query(
        `UPDATE filing_intelligence.filing_retrieval_activation
         SET activation_fingerprint = repeat('0', 64) WHERE family_id = $1`, [second.familyId],
      );
      await assert.rejects(dependencies(pool).scope.resolveCompany({
        ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      }), activeScopeError('FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE'));
    });

  await t.test('current eligibility and representation evidence fail closed on exact mismatch',
    async () => {
      const cases = [
        {
          sql: `UPDATE filing_intelligence.filing_retrieval_eligibility
                SET revision = revision + 1 WHERE document_id = $1`,
          code: 'FILING_ACTIVE_SCOPE_ELIGIBILITY_STALE',
        },
        {
          sql: `UPDATE filing_intelligence.filing_retrieval_eligibility
                SET eligibility_fingerprint = repeat('0', 64) WHERE document_id = $1`,
          code: 'FILING_ACTIVE_SCOPE_ELIGIBILITY_STALE',
        },
      ] as const;
      for (const [index, failure] of cases.entries()) {
        await clearPersistence(pool);
        const root = await persistFamily(pool, `20990809${String(index).padStart(6, '0')}`);
        await pool.query(failure.sql, [root.document.documentId]);
        await assert.rejects(dependencies(pool).scope.resolveCompany({
          ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
        }), activeScopeError(failure.code));
      }
    });

  await t.test('multi-family ordering, 20/21 bounds, and repeated bounded reads are deterministic',
    async () => {
      await clearPersistence(pool);
      const documents: string[] = [];
      for (let index = 0; index < 20; index += 1) {
        const root = await persistFamily(pool, `209909${String(index).padStart(8, '0')}`);
        documents.push(root.document.documentId);
      }
      const current = dependencies(pool);
      const twenty = await current.scope.resolveCompany({
        ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      });
      assert.equal(twenty.entries.length, 20);
      assert.deepEqual(twenty.documentIds, documents);
      for (let index = 0; index < 200; index += 1) {
        const repeated = await current.scope.resolveCompany({
          ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
        });
        assert.equal(repeated.scopeFingerprint, twenty.scopeFingerprint);
      }
      await persistFamily(pool, '20990999000000');
      await assert.rejects(current.scope.resolveCompany({
        ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      }), activeScopeError('FILING_ACTIVE_SCOPE_TOO_LARGE'));
    });

  await t.test('concurrent switch reads return a complete old or new target only', async () => {
    await clearPersistence(pool);
    const rootReceipt = '20990810000000';
    const root = await persistFamily(pool, rootReceipt);
    const correction = await addCorrection(pool, rootReceipt, '20990810000001');
    const current = dependencies(pool);
    const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(
      resolutionInput(rootReceipt),
    );
    const [scope] = await Promise.all([
      current.scope.resolveCompany({
        ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      }),
      current.activation.apply({
        resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      }),
    ]);
    assert.equal(scope.entries.length, 1);
    assert.equal([root.document.documentId, correction.documentId]
      .includes(scope.documentIds[0]!), true);
    assert.equal(scope.entries[0]?.documentId, scope.documentIds[0]);
  });

  await t.test('multi-family scope uses one snapshot while one family switches', async () => {
    await clearPersistence(pool);
    const switchingReceipt = '20990811000000';
    const switching = await persistFamily(pool, switchingReceipt);
    const stable = await persistFamily(pool, '20990812000000');
    const correction = await addCorrection(pool, switchingReceipt, '20990811000001');
    const current = dependencies(pool);
    const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(
      resolutionInput(switchingReceipt),
    );
    const [scope] = await Promise.all([
      current.scope.resolveCompany({
        ...COMPANY, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      }),
      current.activation.apply({
        resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      }),
    ]);
    assert.equal(scope.entries.length, 2);
    assert.equal(scope.documentIds.includes(stable.document.documentId), true);
    assert.equal([switching.document.documentId, correction.documentId]
      .filter(documentId => scope.documentIds.includes(documentId)).length, 1);
    assert.deepEqual(scope.entries.map(entry => entry.documentId), scope.documentIds);
  });
});
