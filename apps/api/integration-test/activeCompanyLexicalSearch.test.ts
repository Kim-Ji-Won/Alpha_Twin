import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { ActiveFilingScopeRepository } from '../src/filingIntelligence/activeScope/activeFilingScopeRepository.js';
import { ActiveFilingScopeService } from '../src/filingIntelligence/activeScope/activeFilingScopeService.js';
import { ActiveFilingScopeError } from '../src/filingIntelligence/activeScope/errors.js';
import { FilingRetrievalActivationRepository } from '../src/filingIntelligence/activation/filingRetrievalActivationRepository.js';
import { FilingRetrievalActivationService } from '../src/filingIntelligence/activation/filingRetrievalActivationService.js';
import { FilingEligibilityRepository } from '../src/filingIntelligence/eligibility/filingEligibilityRepository.js';
import { FILING_RETRIEVAL_POLICY } from '../src/filingIntelligence/eligibility/policies.js';
import { FilingLexicalRepository } from '../src/filingIntelligence/lexical/filingLexicalRepository.js';
import { FilingLineageRepository } from '../src/filingIntelligence/lineage/filingLineageRepository.js';
import { FilingDocumentRepository } from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { ActiveCompanyLexicalSearchService } from '../src/filingIntelligence/retrieval/activeCompanyLexicalSearchService.js';
import { FilingResolutionControlRepository } from '../src/filingIntelligence/resolution/controlRepository.js';
import { VerifiedFilingGraphRepository } from '../src/filingIntelligence/resolution/graphRepository.js';
import { FilingResolutionService } from '../src/filingIntelligence/resolution/service.js';
import { clearPersistence, requiredTestDatabaseUrl, runMigrations } from './helpers/database.js';
import { syntheticPersistenceInputFor } from './helpers/filingFixture.js';

const COMPANY = { corpCode: '66666666', symbol: '666666' };
const OTHER_COMPANY = { corpCode: '55555555', symbol: '555555' };
const HASH = '6'.repeat(64);

function familyInput(rootReceiptNumber: string, company = COMPANY) {
  return {
    provider: 'opendart-fss' as const, ...company,
    lineageRootReceiptNumber: rootReceiptNumber,
    verificationSource: 'trusted_backfill' as const, verificationReferenceHash: HASH,
  };
}

function resolutionInput(rootReceiptNumber: string, company = COMPANY) {
  return {
    provider: 'opendart-fss' as const, ...company,
    lineageRootReceiptNumber: rootReceiptNumber,
  };
}

function receiptMetadata(receiptNumber: string, company = COMPANY) {
  return {
    provider: 'opendart-fss' as const, receiptNumber, ...company,
    companyName: `RETRIEVAL ${company.symbol}`, reportName: '합성 사업보고서',
    reportCode: '11011', filingDate: '2099-01-01', legalStatus: 'reported_active' as const,
    metadataSource: 'active-company-lexical-integration-test',
    metadataObservedAt: '2099-08-30T00:00:00.000Z',
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
    lexical: new FilingLexicalRepository(pool),
  };
}

async function persistFamily(
  pool: Pool,
  rootReceiptNumber: string,
  text: string,
  activate = true,
  company = COMPANY,
) {
  const persistence = new FilingDocumentRepository(pool);
  const lineage = new FilingLineageRepository(pool);
  await lineage.persistReceipt(receiptMetadata(rootReceiptNumber, company));
  const document = await persistence.persistCanonicalFiling(syntheticPersistenceInputFor({
    receiptNumber: rootReceiptNumber, ...company, companyName: `RETRIEVAL ${company.symbol}`,
    paragraphTexts: [text, `${text} 추가 근거`],
  }));
  await new FilingLexicalRepository(pool).indexFilingDocumentLexically(document.documentId);
  const family = await lineage.persistVerifiedReportFamily(familyInput(rootReceiptNumber, company));
  if (activate) {
    const current = dependencies(pool);
    const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(
      resolutionInput(rootReceiptNumber, company),
    );
    const result = await current.activation.apply({
      resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
    });
    assert.equal(result.status, 'activated');
  }
  return { document, familyId: family.familyId };
}

async function addCorrection(
  pool: Pool,
  rootReceiptNumber: string,
  correctionReceiptNumber: string,
  text: string,
) {
  const persistence = new FilingDocumentRepository(pool);
  const lineage = new FilingLineageRepository(pool);
  await lineage.persistReceipt(receiptMetadata(correctionReceiptNumber));
  const document = await persistence.persistCanonicalFiling(syntheticPersistenceInputFor({
    receiptNumber: correctionReceiptNumber, ...COMPANY, companyName: 'RETRIEVAL 666666',
    paragraphTexts: [text, `${text} 정정 근거`],
  }));
  await new FilingLexicalRepository(pool).indexFilingDocumentLexically(document.documentId);
  await lineage.persistVerifiedCorrectionRelation({
    ...familyInput(rootReceiptNumber), correctionReceiptNumber,
    correctsReceiptNumber: rootReceiptNumber, relationType: 'corrects',
    relationSource: 'trusted_backfill', relationReferenceHash: HASH,
    verifiedAt: '2099-08-30T00:00:00.000Z',
  });
  return document;
}

function orchestration(pool: Pool) {
  const current = dependencies(pool);
  return new ActiveCompanyLexicalSearchService(current.scope, current.lexical);
}

async function authoritativeState(pool: Pool): Promise<readonly string[]> {
  const tables = [
    'filing_receipt', 'filing_document', 'filing_lexical_generation',
    'filing_document_representation_manifest', 'filing_retrieval_eligibility',
    'filing_retrieval_activation', 'filing_retrieval_activation_history',
    'filing_family_resolution_control',
  ];
  const state: string[] = [];
  for (const table of tables) {
    const result = await pool.query<{ snapshot: unknown }>(
      `SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY to_jsonb(row_data)::text), '[]')
         AS snapshot FROM filing_intelligence.${table} row_data`,
    );
    state.push(JSON.stringify(result.rows[0]?.snapshot));
  }
  return state;
}

test('verified active company lexical orchestration PostgreSQL integration', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({
    connectionString: databaseUrl, max: 12, connectionTimeoutMillis: 2_000,
    statement_timeout: 30_000,
    application_name: 'alpha-twin-active-company-lexical-integration-test',
  });
  t.after(async () => pool.end());
  await runMigrations('up', databaseUrl);

  await t.test('active multi-family search preserves direct ranking, provenance, and read-only state',
    async () => {
      await clearPersistence(pool);
      const first = await persistFamily(pool, '20991101000001', '공통검색 반도체 위험 위험');
      const second = await persistFamily(pool, '20991101000002', '공통검색 반도체 위험');
      const current = dependencies(pool);
      let scopeCalls = 0;
      let lexicalCalls = 0;
      const scopeRepository = new ActiveFilingScopeRepository(pool);
      const countedScope = new ActiveFilingScopeService({
        loadFamily: scopeRepository.loadFamily.bind(scopeRepository),
        async loadCompany(corpCode, symbol, retrievalPolicyId) {
          scopeCalls += 1;
          return scopeRepository.loadCompany(corpCode, symbol, retrievalPolicyId);
        },
      });
      const countedLexical = {
        async retrieveLexicalFilingChunks(
          input: Parameters<FilingLexicalRepository['retrieveLexicalFilingChunks']>[0],
        ) {
          lexicalCalls += 1;
          return current.lexical.retrieveLexicalFilingChunks(input);
        },
      };
      const service = new ActiveCompanyLexicalSearchService(countedScope, countedLexical);
      const before = await authoritativeState(pool);
      const result = await service.search({ ...COMPANY, query: '공통검색 위험', topK: 20 });
      const direct = await current.lexical.retrieveLexicalFilingChunks({
        ...COMPANY, documentIds: result.scope.documentIds, query: '공통검색 위험', topK: 20,
      });
      const after = await authoritativeState(pool);
      assert.equal(result.status, 'matched');
      assert.deepEqual(result.scope.documentIds,
        [first.document.documentId, second.document.documentId]);
      assert.deepEqual(result.candidates, direct);
      assert.deepEqual(result.candidates.map(value => [value.chunkId, value.lexicalRank]),
        direct.map(value => [value.chunkId, value.lexicalRank]));
      assert.match(result.scope.scopeFingerprint, /^[0-9a-f]{64}$/u);
      assert.deepEqual([scopeCalls, lexicalCalls], [1, 1]);
      assert.deepEqual(after, before);
    });

  await t.test('empty and manual-hold veto scopes execute no lexical search', async () => {
    await clearPersistence(pool);
    const lexical = new FilingLexicalRepository(pool);
    let lexicalCalls = 0;
    const counted = {
      async retrieveLexicalFilingChunks(
        input: Parameters<FilingLexicalRepository['retrieveLexicalFilingChunks']>[0],
      ) { lexicalCalls += 1; return lexical.retrieveLexicalFilingChunks(input); },
    };
    let service = new ActiveCompanyLexicalSearchService(dependencies(pool).scope, counted);
    assert.equal((await service.search({ ...COMPANY, query: '검색' })).status, 'scope_empty');
    const active = await persistFamily(pool, '20991102000001', '검색 대상');
    await new FilingResolutionControlRepository(pool).setHold({
      familyId: active.familyId, expectedRevision: null, reasonCode: 'emergency_hold',
      referenceHash: HASH, expiresAt: '2099-12-01T00:00:00.000Z',
    });
    service = new ActiveCompanyLexicalSearchService(dependencies(pool).scope, counted);
    const held = await service.search({ ...COMPANY, query: '검색' });
    assert.deepEqual([held.status, held.scope.vetoes[0]?.reason, lexicalCalls],
      ['scope_empty', 'manual_hold', 0]);
  });

  await t.test('legacy divergence, eligible inactive, historical, and cross-company data never enter scope',
    async () => {
      await clearPersistence(pool);
      const rootReceipt = '20991103000001';
      const historical = await persistFamily(pool, rootReceipt, '격리검색 과거 문서');
      const active = await addCorrection(pool, rootReceipt, '20991103000002', '격리검색 현재 문서');
      const current = dependencies(pool);
      const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(
        resolutionInput(rootReceipt),
      );
      await current.activation.apply({
        resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
      });
      const inactive = await persistFamily(pool, '20991103000003', '격리검색 비활성 문서', false);
      await new FilingEligibilityRepository(pool).evaluateDocumentEligibility(
        inactive.document.documentId, FILING_RETRIEVAL_POLICY.policyId,
      );
      const foreign = await persistFamily(
        pool, '20991103000004', '격리검색 타사 최강 최강', true, OTHER_COMPANY,
      );
      await pool.query(
        `UPDATE filing_intelligence.filing_document
         SET is_current_effective = CASE WHEN id = $1 THEN true ELSE false END,
             is_retrieval_ready = CASE WHEN id = $1 THEN true ELSE false END,
             activated_at = CASE WHEN id = $1 THEN now() ELSE null END`,
        [historical.document.documentId],
      );
      const result = await orchestration(pool).search({ ...COMPANY, query: '격리검색', topK: 20 });
      assert.deepEqual(result.scope.documentIds, [active.documentId]);
      assert.ok(result.candidates.length > 0);
      assert.ok(result.candidates.every(value => value.documentId === active.documentId));
      assert.equal(result.candidates.some(value => [historical.document.documentId,
        inactive.document.documentId, foreign.document.documentId].includes(value.documentId)), false);
    });

  await t.test('scope integrity failure is fail-closed before lexical execution', async () => {
    await clearPersistence(pool);
    const active = await persistFamily(pool, '20991104000001', '무결성 검색');
    await pool.query(
      `UPDATE filing_intelligence.filing_retrieval_activation
       SET activation_fingerprint = repeat('0', 64) WHERE family_id = $1`, [active.familyId],
    );
    let lexicalCalls = 0;
    const service = new ActiveCompanyLexicalSearchService(dependencies(pool).scope, {
      async retrieveLexicalFilingChunks() { lexicalCalls += 1; return []; },
    });
    await assert.rejects(service.search({ ...COMPANY, query: '무결성' }),
      (error: unknown) => error instanceof ActiveFilingScopeError
        && error.code === 'FILING_ACTIVE_SCOPE_ACTIVATION_INTEGRITY_FAILURE');
    assert.equal(lexicalCalls, 0);
  });

  await t.test('in-flight switch remains on D1 while the subsequent request uses D2', async () => {
    await clearPersistence(pool);
    const rootReceipt = '20991105000001';
    const first = await persistFamily(pool, rootReceipt, '전환검색 이전');
    const second = await addCorrection(pool, rootReceipt, '20991105000002', '전환검색 이후');
    const current = dependencies(pool);
    const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(
      resolutionInput(rootReceipt),
    );
    let switched = false;
    const service = new ActiveCompanyLexicalSearchService(current.scope, {
      async retrieveLexicalFilingChunks(input) {
        if (!switched) {
          switched = true;
          await current.activation.apply({
            resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
          });
        }
        return current.lexical.retrieveLexicalFilingChunks(input);
      },
    });
    const inFlight = await service.search({ ...COMPANY, query: '전환검색' });
    const subsequent = await service.search({ ...COMPANY, query: '전환검색' });
    assert.deepEqual(inFlight.scope.documentIds, [first.document.documentId]);
    assert.ok(inFlight.candidates.every(value => value.documentId === first.document.documentId));
    assert.deepEqual(subsequent.scope.documentIds, [second.documentId]);
    assert.ok(subsequent.candidates.every(value => value.documentId === second.documentId));
    assert.notEqual(inFlight.scope.scopeFingerprint, subsequent.scope.scopeFingerprint);
  });

  await t.test('in-flight hold may complete while the subsequent request is vetoed', async () => {
    await clearPersistence(pool);
    const active = await persistFamily(pool, '20991106000001', '보류경쟁 검색');
    const current = dependencies(pool);
    let held = false;
    const service = new ActiveCompanyLexicalSearchService(current.scope, {
      async retrieveLexicalFilingChunks(input) {
        if (!held) {
          held = true;
          await new FilingResolutionControlRepository(pool).setHold({
            familyId: active.familyId, expectedRevision: null, reasonCode: 'emergency_hold',
            referenceHash: HASH, expiresAt: '2099-12-01T00:00:00.000Z',
          });
        }
        return current.lexical.retrieveLexicalFilingChunks(input);
      },
    });
    const inFlight = await service.search({ ...COMPANY, query: '보류경쟁' });
    const subsequent = await service.search({ ...COMPANY, query: '보류경쟁' });
    assert.deepEqual([inFlight.status, inFlight.candidates[0]?.documentId],
      ['matched', active.document.documentId]);
    assert.deepEqual([subsequent.status, subsequent.candidates.length,
      subsequent.scope.vetoes[0]?.reason], ['scope_empty', 0, 'manual_hold']);
  });

  await t.test('20 families stay bounded and deterministic while 21 fail before lexical retrieval',
    async () => {
      await clearPersistence(pool);
      const documentIds: string[] = [];
      for (let index = 0; index < 20; index += 1) {
        const family = await persistFamily(
          pool, `209912${String(index).padStart(8, '0')}`, `성능검색 family ${index}`,
        );
        documentIds.push(family.document.documentId);
      }
      let lexicalCalls = 0;
      const current = dependencies(pool);
      const service = new ActiveCompanyLexicalSearchService(current.scope, {
        async retrieveLexicalFilingChunks(input) {
          lexicalCalls += 1;
          return current.lexical.retrieveLexicalFilingChunks(input);
        },
      });
      const first = await service.search({ ...COMPANY, query: '성능검색', topK: 20 });
      assert.deepEqual(first.scope.documentIds, documentIds);
      assert.equal(first.candidates.length <= 20, true);
      const started = performance.now();
      for (let index = 0; index < 200; index += 1) {
        const repeated = await service.search({ ...COMPANY, query: '성능검색', topK: 20 });
        assert.equal(repeated.scope.scopeFingerprint, first.scope.scopeFingerprint);
        assert.deepEqual(repeated.candidates.map(value => [value.chunkId, value.lexicalRank]),
          first.candidates.map(value => [value.chunkId, value.lexicalRank]));
      }
      assert.equal(lexicalCalls, 201);
      assert.ok(performance.now() - started >= 0);
      await persistFamily(pool, '20991299000000', '성능검색 overflow');
      await assert.rejects(service.search({ ...COMPANY, query: '성능검색' }),
        (error: unknown) => error instanceof ActiveFilingScopeError
          && error.code === 'FILING_ACTIVE_SCOPE_TOO_LARGE');
      assert.equal(lexicalCalls, 201);
    });
});
