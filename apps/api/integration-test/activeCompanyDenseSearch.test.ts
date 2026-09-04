import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { ActiveFilingScopeRepository } from '../src/filingIntelligence/activeScope/activeFilingScopeRepository.js';
import { ActiveFilingScopeService } from '../src/filingIntelligence/activeScope/activeFilingScopeService.js';
import { ActiveFilingScopeError } from '../src/filingIntelligence/activeScope/errors.js';
import { FilingRetrievalActivationRepository } from '../src/filingIntelligence/activation/filingRetrievalActivationRepository.js';
import { FilingRetrievalActivationService } from '../src/filingIntelligence/activation/filingRetrievalActivationService.js';
import { EmbeddingProvider } from '../src/filingIntelligence/dense/embeddingProvider.js';
import { FilingDenseError } from '../src/filingIntelligence/dense/errors.js';
import { FilingDenseRepository } from '../src/filingIntelligence/dense/filingDenseRepository.js';
import { FilingDenseRetrievalRepository } from '../src/filingIntelligence/dense/filingDenseRetrievalRepository.js';
import { FILING_DENSE_PROFILES } from '../src/filingIntelligence/dense/profile.js';
import { FilingEligibilityRepository } from '../src/filingIntelligence/eligibility/filingEligibilityRepository.js';
import { FILING_RETRIEVAL_POLICY } from '../src/filingIntelligence/eligibility/policies.js';
import { FilingLexicalRepository } from '../src/filingIntelligence/lexical/filingLexicalRepository.js';
import { FilingLineageRepository } from '../src/filingIntelligence/lineage/filingLineageRepository.js';
import { FilingDocumentRepository } from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { ActiveCompanyDenseSearchService } from '../src/filingIntelligence/retrieval/activeCompanyDenseSearchService.js';
import { FilingResolutionControlRepository } from '../src/filingIntelligence/resolution/controlRepository.js';
import { VerifiedFilingGraphRepository } from '../src/filingIntelligence/resolution/graphRepository.js';
import { FilingResolutionService } from '../src/filingIntelligence/resolution/service.js';
import { clearPersistence, requiredTestDatabaseUrl, runMigrations } from './helpers/database.js';
import { syntheticPersistenceInputFor } from './helpers/filingFixture.js';

const COMPANY = { corpCode: '44444444', symbol: '444444' };
const OTHER_COMPANY = { corpCode: '33333333', symbol: '333333' };
const PROFILE = FILING_DENSE_PROFILES.openAiSmall1536;
const HASH = '4'.repeat(64);

const axis = (x: number, y = 0): number[] => {
  const value = Array<number>(1536).fill(0);
  value[0] = x;
  value[1] = y;
  return value;
};

function familyInput(rootReceiptNumber: string, company = COMPANY) {
  return {
    provider: 'opendart-fss' as const, ...company,
    lineageRootReceiptNumber: rootReceiptNumber,
    verificationSource: 'trusted_backfill' as const, verificationReferenceHash: HASH,
  };
}

function resolutionInput(rootReceiptNumber: string, company = COMPANY) {
  return { provider: 'opendart-fss' as const, ...company,
    lineageRootReceiptNumber: rootReceiptNumber };
}

function receiptMetadata(receiptNumber: string, company = COMPANY) {
  return {
    provider: 'opendart-fss' as const, receiptNumber, ...company,
    companyName: `DENSE ${company.symbol}`, reportName: '합성 사업보고서',
    reportCode: '11011', filingDate: '2099-01-01', legalStatus: 'reported_active' as const,
    metadataSource: 'active-company-dense-integration-test',
    metadataObservedAt: '2099-09-01T00:00:00.000Z',
  };
}

function lifecycle(pool: Pool) {
  const graphs = new VerifiedFilingGraphRepository(pool);
  return {
    resolver: new FilingResolutionService(graphs),
    activation: new FilingRetrievalActivationService(
      new FilingRetrievalActivationRepository(pool), graphs, new FilingEligibilityRepository(pool),
    ),
    scope: new ActiveFilingScopeService(new ActiveFilingScopeRepository(pool)),
  };
}

async function activateFamily(pool: Pool, rootReceiptNumber: string, company = COMPANY) {
  const current = lifecycle(pool);
  const resolution = await current.resolver.resolveCurrentEffectiveReceiptCandidate(
    resolutionInput(rootReceiptNumber, company),
  );
  const result = await current.activation.apply({
    resolution, retrievalPolicyId: FILING_RETRIEVAL_POLICY.policyId,
  });
  assert.ok(result.status === 'activated' || result.status === 'switched');
}

type DenseState = 'ready' | 'building' | 'failed' | 'missing';

async function persistFamily(
  pool: Pool,
  rootReceiptNumber: string,
  text: string,
  denseState: DenseState,
  vector: readonly number[],
  company = COMPANY,
  activate = true,
) {
  const persistence = new FilingDocumentRepository(pool);
  const lineage = new FilingLineageRepository(pool);
  await lineage.persistReceipt(receiptMetadata(rootReceiptNumber, company));
  const document = await persistence.persistCanonicalFiling(syntheticPersistenceInputFor({
    receiptNumber: rootReceiptNumber, ...company, companyName: `DENSE ${company.symbol}`,
    paragraphTexts: [text, `${text} 추가 근거`],
  }));
  await new FilingLexicalRepository(pool).indexFilingDocumentLexically(document.documentId);
  const family = await lineage.persistVerifiedReportFamily(familyInput(rootReceiptNumber, company));
  let generationId: string | undefined;
  if (denseState !== 'missing') {
    const dense = new FilingDenseRepository(pool);
    const created = await dense.createGeneration(document.documentId, PROFILE.profileId);
    generationId = created.generation.generationId;
    if (denseState === 'ready') {
      await dense.persistVectorBatch(generationId, created.chunks.map(chunk => ({ ...chunk, vector })));
      await dense.finalizeGeneration(generationId);
    } else if (denseState === 'failed') {
      await pool.query(`UPDATE filing_intelligence.filing_dense_generation
        SET status='failed', failure_code='DENSE_TEST_FAILURE' WHERE id=$1`, [generationId]);
    }
  }
  if (activate) await activateFamily(pool, rootReceiptNumber, company);
  return { document, familyId: family.familyId, generationId };
}

async function addCorrection(
  pool: Pool,
  rootReceiptNumber: string,
  correctionReceiptNumber: string,
  text: string,
  vector: readonly number[],
) {
  const lineage = new FilingLineageRepository(pool);
  await lineage.persistReceipt(receiptMetadata(correctionReceiptNumber));
  const document = await new FilingDocumentRepository(pool).persistCanonicalFiling(
    syntheticPersistenceInputFor({ receiptNumber: correctionReceiptNumber, ...COMPANY,
      companyName: 'DENSE 444444', paragraphTexts: [text, `${text} 정정 근거`] }),
  );
  await new FilingLexicalRepository(pool).indexFilingDocumentLexically(document.documentId);
  await lineage.persistVerifiedCorrectionRelation({
    ...familyInput(rootReceiptNumber), correctionReceiptNumber,
    correctsReceiptNumber: rootReceiptNumber, relationType: 'corrects',
    relationSource: 'trusted_backfill', relationReferenceHash: HASH,
    verifiedAt: '2099-09-01T00:00:00.000Z',
  });
  const dense = new FilingDenseRepository(pool);
  const created = await dense.createGeneration(document.documentId, PROFILE.profileId);
  await dense.persistVectorBatch(created.generation.generationId,
    created.chunks.map(chunk => ({ ...chunk, vector })));
  await dense.finalizeGeneration(created.generation.generationId);
  return { document, generationId: created.generation.generationId };
}

function fakeProvider(
  vector: readonly number[],
  onCall?: () => void | Promise<void>,
  metrics = { calls: 0, inputs: 0 },
): EmbeddingProvider {
  return {
    async embedBatch(profile, inputs) {
      metrics.calls += 1;
      metrics.inputs += inputs.length;
      await onCall?.();
      return { provider: 'openai', model: profile.modelId, tokenCount: 2,
        vectors: inputs.map(input => ({ inputId: input.inputId, vector })) };
    },
  };
}

function countedPool(pool: Pool, count: () => void): Pool {
  return { query(text: string, values?: unknown[]) { count(); return pool.query(text, values); } } as
    unknown as Pool;
}

function service(pool: Pool, provider: EmbeddingProvider, counts?: { scope: number; dense: number }) {
  const scopePool = counts == null ? pool : countedPool(pool, () => { counts.scope += 1; });
  const densePool = counts == null ? pool : countedPool(pool, () => { counts.dense += 1; });
  return new ActiveCompanyDenseSearchService(
    new ActiveFilingScopeService(new ActiveFilingScopeRepository(scopePool)),
    new FilingDenseRetrievalRepository(densePool), provider,
  );
}

async function authoritativeState(pool: Pool): Promise<readonly string[]> {
  const tables = [
    'filing_dense_generation', 'filing_chunk_embedding', 'filing_dense_generation_job',
    'filing_dense_generation_attempt', 'filing_retrieval_eligibility',
    'filing_retrieval_activation', 'filing_retrieval_activation_history',
    'filing_family_resolution_control',
  ];
  const state: string[] = [];
  for (const table of tables) {
    const result = await pool.query<{ snapshot: unknown }>(
      `SELECT coalesce(jsonb_agg(to_jsonb(value) ORDER BY to_jsonb(value)::text), '[]')
         AS snapshot FROM filing_intelligence.${table} AS value`,
    );
    state.push(JSON.stringify(result.rows[0]?.snapshot));
  }
  const legacy = await pool.query<{ snapshot: unknown }>(`SELECT coalesce(jsonb_agg(
    jsonb_build_object('id',id::text,'current',is_current_effective,'ready',is_retrieval_ready,
      'activatedAt',activated_at) ORDER BY id), '[]') AS snapshot
    FROM filing_intelligence.filing_document`);
  state.push(JSON.stringify(legacy.rows[0]?.snapshot));
  return state;
}

test('active company dense orchestration PostgreSQL integration', async t => {
  const databaseUrl = requiredTestDatabaseUrl();
  const pool = new Pool({ connectionString: databaseUrl, max: 12, statement_timeout: 60_000,
    application_name: 'alpha-twin-active-company-dense-integration-test' });
  t.after(async () => pool.end());
  await runMigrations('up', databaseUrl, true);

  await t.test('multi-family matched search is three-query, globally ranked, and read-only', async () => {
    await clearPersistence(pool);
    const first = await persistFamily(pool, '20991001000001', 'dense 첫 문서', 'ready', axis(1));
    const second = await persistFamily(pool, '20991001000002', 'dense 둘째 문서', 'ready', axis(0, 1));
    const metrics = { calls: 0, inputs: 0 };
    const counts = { scope: 0, dense: 0 };
    const provider = fakeProvider(axis(1), undefined, metrics);
    const orchestration = service(pool, provider, counts);
    const before = await authoritativeState(pool);
    const result = await orchestration.search({ ...COMPANY, query: '  반도체 위험  ',
      denseProfileId: PROFILE.profileId, topK: 20 });
    const after = await authoritativeState(pool);
    assert.equal(result.status, 'matched');
    assert.deepEqual(result.scope.documentIds,
      [first.document.documentId, second.document.documentId]);
    assert.equal(result.candidates[0]?.documentId, first.document.documentId);
    assert.deepEqual(result.candidates.map(value => value.denseRank),
      result.candidates.map((_, index) => index + 1));
    assert.deepEqual([counts.scope, counts.dense, metrics.calls, metrics.inputs], [1, 2, 1, 1]);
    assert.deepEqual(after, before);
    assert.equal(result.generations.length, 2);
    const direct = await new FilingDenseRetrievalRepository(pool).retrieveDenseFilingChunks({
      ...COMPANY, denseProfileId: PROFILE.profileId,
      denseProfileFingerprint: PROFILE.profileFingerprint,
      generations: result.generations, queryVector: axis(1), topK: 20,
    });
    assert.deepEqual(result.candidates, direct);
  });

  await t.test('empty, hold, and no-match paths preserve short-circuit semantics', async () => {
    await clearPersistence(pool);
    const metrics = { calls: 0, inputs: 0 };
    let result = await service(pool, fakeProvider(axis(1), undefined, metrics)).search({
      ...COMPANY, query: '\u0000', denseProfileId: PROFILE.profileId,
    });
    assert.equal(result.status, 'scope_empty');
    const active = await persistFamily(pool, '20991002000001', 'hold 문서', 'ready', axis(1));
    await new FilingResolutionControlRepository(pool).setHold({
      familyId: active.familyId, expectedRevision: null, reasonCode: 'emergency_hold',
      referenceHash: HASH, expiresAt: '2099-12-01T00:00:00.000Z',
    });
    result = await service(pool, fakeProvider(axis(1), undefined, metrics)).search({
      ...COMPANY, query: '\u0000', denseProfileId: PROFILE.profileId,
    });
    assert.equal(result.status, 'scope_empty');
    assert.equal(result.scope.vetoes[0]?.reason, 'manual_hold');
    assert.equal(metrics.calls, 0);

    await clearPersistence(pool);
    await persistFamily(pool, '20991002000002', 'no match 문서', 'ready', axis(1));
    const dense = new FilingDenseRetrievalRepository(pool);
    const noMatchService = new ActiveCompanyDenseSearchService(lifecycle(pool).scope, {
      resolveDenseReadiness: dense.resolveDenseReadiness.bind(dense),
      async retrieveDenseFilingChunks() { return []; },
    }, fakeProvider(axis(1), undefined, metrics));
    assert.equal((await noMatchService.search({ ...COMPANY, query: '일치 없음',
      denseProfileId: PROFILE.profileId })).status, 'no_matches');
    assert.equal(metrics.calls, 1);
  });

  await t.test('missing, building, and failed profiles remain full-scope dense_not_ready', async () => {
    for (const state of ['missing', 'building', 'failed'] as const) {
      await clearPersistence(pool);
      await persistFamily(pool, `20991003${state === 'missing' ? '000001' : state === 'building'
        ? '000002' : '000003'}`, `${state} dense`, 'ready', axis(1));
      const unavailable = await persistFamily(pool,
        `20991004${state === 'missing' ? '000001' : state === 'building' ? '000002' : '000003'}`,
        `${state} unavailable`, state, axis(0, 1));
      const metrics = { calls: 0, inputs: 0 };
      const result = await service(pool, fakeProvider(axis(1), undefined, metrics)).search({
        ...COMPANY, query: '준비 상태', denseProfileId: PROFILE.profileId,
      });
      assert.equal(result.status, 'dense_not_ready');
      if (result.status !== 'dense_not_ready') continue;
      assert.deepEqual(result.generations, []);
      assert.deepEqual(result.reasons, [{ documentId: unavailable.document.documentId,
        reason: `generation_${state}` }]);
      assert.equal(metrics.calls, 0);
    }
  });

  await t.test('switch and hold races retain one verified request snapshot', async () => {
    await clearPersistence(pool);
    const root = '20991005000001';
    const first = await persistFamily(pool, root, 'switch 이전', 'ready', axis(1));
    const second = await addCorrection(pool, root, '20991005000002', 'switch 이후', axis(1));
    let switched = false;
    const switching = service(pool, fakeProvider(axis(1), async () => {
      if (!switched) { switched = true; await activateFamily(pool, root); }
    }));
    const inFlight = await switching.search({ ...COMPANY, query: '전환', denseProfileId: PROFILE.profileId });
    const subsequent = await switching.search({ ...COMPANY, query: '전환', denseProfileId: PROFILE.profileId });
    assert.deepEqual(inFlight.scope.documentIds, [first.document.documentId]);
    assert.ok(inFlight.candidates.every(value => value.documentId === first.document.documentId));
    assert.deepEqual(subsequent.scope.documentIds, [second.document.documentId]);
    assert.notEqual(inFlight.scope.scopeFingerprint, subsequent.scope.scopeFingerprint);

    await clearPersistence(pool);
    const held = await persistFamily(pool, '20991005000003', 'hold race', 'ready', axis(1));
    let holdApplied = false;
    const holding = service(pool, fakeProvider(axis(1), async () => {
      if (!holdApplied) {
        holdApplied = true;
        await new FilingResolutionControlRepository(pool).setHold({
          familyId: held.familyId, expectedRevision: null, reasonCode: 'emergency_hold',
          referenceHash: HASH, expiresAt: '2099-12-01T00:00:00.000Z',
        });
      }
    }));
    const beforeHold = await holding.search({ ...COMPANY, query: '보류', denseProfileId: PROFILE.profileId });
    const afterHold = await holding.search({ ...COMPANY, query: '보류', denseProfileId: PROFILE.profileId });
    assert.equal(beforeHold.status, 'matched');
    assert.equal(afterHold.status, 'scope_empty');
    assert.equal(afterHold.scope.vetoes[0]?.reason, 'manual_hold');
  });

  await t.test('generation drift during provider call fails closed without replacement', async () => {
    await clearPersistence(pool);
    const active = await persistFamily(pool, '20991006000001', 'generation drift',
      'ready', axis(1));
    let providerCalls = 0;
    const orchestration = service(pool, fakeProvider(axis(1), async () => {
      providerCalls += 1;
      await pool.query(`UPDATE filing_intelligence.filing_dense_generation
        SET status='building', generation_fingerprint=NULL, ready_at=NULL WHERE id=$1`,
      [active.generationId]);
    }));
    await assert.rejects(orchestration.search({ ...COMPANY, query: 'drift',
      denseProfileId: PROFILE.profileId }), (value: unknown) => value instanceof FilingDenseError
        && value.code === 'FILING_DENSE_RETRIEVAL_SCOPE_FAILURE');
    assert.equal(providerCalls, 1);
  });

  await t.test('cross-company vectors never enter active company results', async () => {
    await clearPersistence(pool);
    const local = await persistFamily(pool, '20991007000001', 'local', 'ready', axis(0, 1));
    const foreign = await persistFamily(pool, '20991007000002', 'foreign', 'ready', axis(1),
      OTHER_COMPANY);
    const result = await service(pool, fakeProvider(axis(1))).search({
      ...COMPANY, query: '회사 격리', denseProfileId: PROFILE.profileId,
    });
    assert.equal(result.status, 'matched');
    assert.ok(result.candidates.every(value => value.documentId === local.document.documentId));
    assert.equal(result.candidates.some(value => value.documentId === foreign.document.documentId), false);
  });

  await t.test('20 families are bounded while 21 fail before readiness and provider', async () => {
    await clearPersistence(pool);
    for (let index = 0; index < 20; index += 1) {
      await persistFamily(pool, `209911${String(index).padStart(8, '0')}`,
        `dense family ${index}`, 'missing', axis(1));
    }
    const metrics = { calls: 0, inputs: 0 };
    let readinessCalls = 0;
    const dense = new FilingDenseRetrievalRepository(pool);
    const countedDense = {
      async resolveDenseReadiness(input: Parameters<typeof dense.resolveDenseReadiness>[0]) {
        readinessCalls += 1;
        return dense.resolveDenseReadiness(input);
      },
      retrieveDenseFilingChunks: dense.retrieveDenseFilingChunks.bind(dense),
    };
    const current = lifecycle(pool);
    const orchestration = new ActiveCompanyDenseSearchService(
      current.scope, countedDense, fakeProvider(axis(1), undefined, metrics),
    );
    const bounded = await orchestration.search({ ...COMPANY, query: '20개',
      denseProfileId: PROFILE.profileId });
    assert.equal(bounded.status, 'dense_not_ready');
    assert.equal(readinessCalls, 1);
    await persistFamily(pool, '20991199000000', 'overflow family', 'missing', axis(1));
    await assert.rejects(orchestration.search({ ...COMPANY, query: '21개',
      denseProfileId: PROFILE.profileId }), (value: unknown) => value instanceof ActiveFilingScopeError
        && value.code === 'FILING_ACTIVE_SCOPE_TOO_LARGE');
    assert.deepEqual([readinessCalls, metrics.calls], [1, 0]);
  });
});
