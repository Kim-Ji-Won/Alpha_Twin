import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { ActiveFilingScopeRepository } from '../src/filingIntelligence/activeScope/activeFilingScopeRepository.js';
import { ActiveFilingScopeService } from '../src/filingIntelligence/activeScope/activeFilingScopeService.js';
import { FilingRetrievalActivationRepository } from '../src/filingIntelligence/activation/filingRetrievalActivationRepository.js';
import { FilingRetrievalActivationService } from '../src/filingIntelligence/activation/filingRetrievalActivationService.js';
import { FilingEligibilityRepository } from '../src/filingIntelligence/eligibility/filingEligibilityRepository.js';
import { FILING_REPRESENTATION_POLICY, FILING_RETRIEVAL_POLICY as V1,
  FILING_RETRIEVAL_POLICY_V2 as V2, LEGACY_FILING_REPRESENTATION_POLICY } from '../src/filingIntelligence/eligibility/policies.js';
import { FilingLexicalRepository } from '../src/filingIntelligence/lexical/filingLexicalRepository.js';
import { FilingLineageRepository } from '../src/filingIntelligence/lineage/filingLineageRepository.js';
import { FilingDocumentRepository } from '../src/filingIntelligence/persistence/filingDocumentRepository.js';
import { ActiveCompanyLexicalSearchService } from '../src/filingIntelligence/retrieval/activeCompanyLexicalSearchService.js';
import { ActiveCompanyDenseSearchService } from '../src/filingIntelligence/retrieval/activeCompanyDenseSearchService.js';
import { MIXED_RETRIEVAL_SCOPE_BINDING } from '../src/filingIntelligence/retrieval/scopeBinding.js';
import { FILING_DENSE_PROFILES } from '../src/filingIntelligence/dense/profile.js';
import { FilingResolutionControlRepository } from '../src/filingIntelligence/resolution/controlRepository.js';
import { VerifiedFilingGraphRepository } from '../src/filingIntelligence/resolution/graphRepository.js';
import { FilingResolutionService } from '../src/filingIntelligence/resolution/service.js';
import { clearPersistence, requiredTestDatabaseUrl, runMigrations } from './helpers/database.js';
import { syntheticLegacyPersistenceInput, syntheticPersistenceInputFor } from './helpers/filingFixture.js';

const COMPANY = { corpCode: '00164779', symbol: '000660' };
const OTHER = { corpCode: '77777777', symbol: '777777' };
const HASH = 'a'.repeat(64);
const MIGRATION = '1755468000000_versioned-legacy-retrieval-admission';
const BASE = '1755295200000_legacy-filing-decoding-provenance';
const receipt = (n: number) => `209912${String(n).padStart(8, '0')}`;

function family(root: string, company = COMPANY) {
  return { provider: 'opendart-fss' as const, ...company, lineageRootReceiptNumber: root,
    verificationSource: 'trusted_backfill' as const, verificationReferenceHash: HASH };
}
function metadata(number: string, company = COMPANY, legalStatus: 'reported_active' | 'withdrawn' | 'cancelled' = 'reported_active') {
  return { provider: 'opendart-fss' as const, receiptNumber: number, ...company,
    companyName: 'SYNTHETIC V2 COMPANY', reportCode: '11011',
    reportName: 'synthetic test', filingDate: '2099-01-01', legalStatus,
    metadataSource: 'synthetic-v2-test', metadataObservedAt: legalStatus === 'reported_active'
      ? '2099-12-01T00:00:00.000Z' : '2099-12-02T00:00:00.000Z' };
}
function services(pool: Pool) {
  const graph = new VerifiedFilingGraphRepository(pool);
  const eligibility = new FilingEligibilityRepository(pool);
  const scopeRepository = new ActiveFilingScopeRepository(pool);
  const scope = new ActiveFilingScopeService(scopeRepository);
  const lexical = new FilingLexicalRepository(pool);
  return { eligibility, scope, scopeRepository, lexical,
    lineage: new FilingLineageRepository(pool),
    resolver: new FilingResolutionService(graph),
    activation: new FilingRetrievalActivationService(new FilingRetrievalActivationRepository(pool), graph, eligibility),
    search: new ActiveCompanyLexicalSearchService(scope, lexical, MIXED_RETRIEVAL_SCOPE_BINDING) };
}
async function document(pool: Pool, number: string, legacy = false, company = COMPANY, index = true) {
  const input = legacy ? syntheticLegacyPersistenceInput(number)
    : syntheticPersistenceInputFor({ receiptNumber: number, ...company,
      paragraphTexts: ['legacy persistence common evidence', 'legacy persistence additional evidence'] });
  const saved = await new FilingDocumentRepository(pool).persistCanonicalFiling({ ...input,
    metadata: { ...input.metadata, ...metadata(number, company), companyName: 'SYNTHETIC V2 COMPANY' } });
  if (index) await new FilingLexicalRepository(pool).indexFilingDocumentLexically(saved.documentId);
  return saved;
}
async function root(pool: Pool, n: number, legacy = false, company = COMPANY, index = true) {
  const saved = await document(pool, receipt(n), legacy, company, index);
  const f = await new FilingLineageRepository(pool).persistVerifiedReportFamily(family(receipt(n), company));
  return { ...saved, familyId: f.familyId, number: receipt(n) };
}
async function activate(pool: Pool, number: string, policy = V2.policyId as string, company = COMPANY) {
  const s = services(pool);
  return s.activation.apply({ retrievalPolicyId: policy,
    resolution: await s.resolver.resolveCurrentEffectiveReceiptCandidate(family(number, company)) });
}
async function snapshot(pool: Pool, onlyV1 = false): Promise<string> {
  const tables = onlyV1 ? ['filing_retrieval_eligibility', 'filing_retrieval_activation', 'filing_retrieval_activation_history']
    : ['filing_document', 'filing_section', 'filing_block', 'filing_chunk',
      'filing_document_representation_manifest', 'filing_lexical_generation',
      'filing_retrieval_eligibility', 'filing_retrieval_activation', 'filing_retrieval_activation_history'];
  const hash = createHash('sha256');
  for (const name of tables) {
    const result = await pool.query(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text), '[]') AS data
      FROM filing_intelligence.${name} r ${onlyV1 ? 'WHERE retrieval_policy_id=$1' : ''}`, onlyV1 ? [V1.policyId] : []);
    hash.update(JSON.stringify(result.rows[0].data));
  }
  return hash.digest('hex');
}
async function latest(pool: Pool) {
  return (await pool.query('SELECT name FROM public.pgmigrations ORDER BY id DESC LIMIT 1')).rows[0]?.name;
}

test('versioned legacy admission PostgreSQL hard gates', async t => {
  const url = requiredTestDatabaseUrl();
  const pool = new Pool({ connectionString: url, max: 8, statement_timeout: 30_000 });
  t.after(async () => pool.end());
  // Existing suites stop at the committed HEAD schema. Keep that migration boundary explicit.
  if (await latest(pool) === MIGRATION) {
    await clearPersistence(pool);
    await runMigrations('down', url, true, true);
  }
  await runMigrations('up', url);
  assert.equal(await latest(pool), BASE);

  await t.test('existing CHECK weakness reproduced; preflight refuses invalid rows; upgrade preserves valid rows', async () => {
    await clearPersistence(pool);
    const d1 = await root(pool, 1);
    const d2 = await root(pool, 2, true);
    await activate(pool, d1.number, V1.policyId);
    await services(pool).eligibility.evaluateDocumentEligibility(d2.documentId, V1.policyId);
    const before = await snapshot(pool);
    const original = (await pool.query('SELECT decoding_profile_fingerprint FROM filing_intelligence.filing_document WHERE id=$1', [d2.documentId])).rows[0].decoding_profile_fingerprint;
    await pool.query('UPDATE filing_intelligence.filing_document SET decoding_profile_fingerprint=NULL WHERE id=$1', [d2.documentId]);
    await assert.rejects(runMigrations('up', url, true, true));
    assert.equal(await latest(pool), BASE);
    await pool.query('UPDATE filing_intelligence.filing_document SET decoding_profile_fingerprint=$2 WHERE id=$1', [d2.documentId, original]);
    assert.equal(await snapshot(pool), before);
    await runMigrations('up', url, true, true);
    assert.equal(await latest(pool), MIGRATION);
    assert.equal(await snapshot(pool), before);
    for (const column of ['decoding_profile_id', 'decoding_profile_fingerprint',
      'source_declared_encoding', 'source_bom_kind', 'source_utf8_validity',
      'canonical_utf8_hash', 'decoder_runtime_label', 'decoding_compatibility_reason']) {
      await assert.rejects(pool.query(`UPDATE filing_intelligence.filing_document
        SET ${column}=NULL WHERE id=$1`, [d2.documentId]), { code: '23514' });
    }
    await runMigrations('down', url, true, true);
    assert.equal(await latest(pool), BASE);
    assert.equal(await snapshot(pool), before);
    await runMigrations('up', url, true, true);
    assert.equal(await snapshot(pool), before);
  });

  await t.test('mixed verified correction chain, policy coexistence, lexical reuse and global ranking', async () => {
    await clearPersistence(pool);
    const d1 = await root(pool, 10);
    const original = await root(pool, 11);
    await activate(pool, d1.number, V1.policyId);
    await activate(pool, original.number, V1.policyId);
    const d2 = await document(pool, receipt(12), true);
    const s = services(pool);
    await s.lineage.persistVerifiedCorrectionRelation({ ...family(original.number),
      correctionReceiptNumber: receipt(12), correctsReceiptNumber: original.number,
      relationType: 'corrects', relationSource: 'trusted_backfill', relationReferenceHash: HASH,
      verifiedAt: '2099-12-01T00:00:00.000Z' });
    const v1Legacy = await s.eligibility.evaluateDocumentEligibility(d2.documentId, V1.policyId);
    assert.equal(v1Legacy.status, 'ineligible');
    assert.equal(v1Legacy.reasonCode, 'representation_policy_mismatch');
    const old = await snapshot(pool, true);
    const v1scope = await s.scope.resolveCompany({ ...COMPANY, retrievalPolicyId: V1.policyId });
    const one = await s.eligibility.evaluateDocumentEligibility(d1.documentId, V2.policyId);
    const two = await s.eligibility.evaluateDocumentEligibility(d2.documentId, V2.policyId);
    assert.equal(one.status, 'eligible'); assert.equal(two.status, 'eligible');
    assert.equal(one.representationPolicyId, FILING_REPRESENTATION_POLICY.policyId);
    assert.equal(two.representationPolicyId, LEGACY_FILING_REPRESENTATION_POLICY.policyId);
    const repeated = await s.eligibility.evaluateDocumentEligibility(d2.documentId, V2.policyId);
    assert.equal(repeated.persistenceStatus, 'already_evaluated'); assert.equal(repeated.revision, two.revision);
    assert.equal((await activate(pool, d1.number)).status, 'activated');
    assert.equal((await activate(pool, original.number)).activation?.documentId, d2.documentId);
    assert.equal((await activate(pool, original.number)).status, 'already_current');
    const scope = await s.scope.resolveCompany({ ...COMPANY, retrievalPolicyId: V2.policyId });
    assert.deepEqual(scope.documentIds, [d1.documentId, d2.documentId]);
    assert.notEqual(scope.scopeFingerprint, v1scope.scopeFingerprint);
    assert.deepEqual(await s.scope.resolveCompany({ ...COMPANY, retrievalPolicyId: V1.policyId })
      .then(value => value.documentIds), v1scope.documentIds);
    assert.equal(await snapshot(pool, true), old);
    const ranking = await s.search.search({ ...COMPANY, query: 'legacy persistence', topK: 20 });
    assert.equal(ranking.status, 'matched');
    assert.deepEqual(new Set(ranking.candidates.map(c => c.documentId)), new Set([d1.documentId, d2.documentId]));
    assert.deepEqual(ranking.candidates, await s.lexical.retrieveLexicalFilingChunks({ ...COMPANY,
      documentIds: scope.documentIds, query: 'legacy persistence', topK: 20 }));
    const generationCount = await pool.query('SELECT count(*)::int AS n FROM filing_intelligence.filing_lexical_generation WHERE document_id=$1', [d1.documentId]);
    assert.equal(generationCount.rows[0].n, 1);
    assert.equal(await snapshot(pool, true), old);
    await s.eligibility.evaluateDocumentEligibility(d1.documentId, V1.policyId);
    await s.eligibility.evaluateDocumentEligibility(d2.documentId, V1.policyId);
    assert.deepEqual(await s.eligibility.evaluateDocumentEligibility(d2.documentId, V2.policyId), repeated);
    let loads = 0;
    const reordered = new ActiveFilingScopeService({ loadFamily: s.scopeRepository.loadFamily.bind(s.scopeRepository),
      async loadCompany(...args) { loads++; return [...await s.scopeRepository.loadCompany(...args)].reverse(); } });
    assert.equal((await reordered.resolveCompany({ ...COMPANY, retrievalPolicyId: V2.policyId })).scopeFingerprint, scope.scopeFingerprint);
    assert.equal(loads, 1);
    let calls = 0;
    const never = async (): Promise<never> => { calls++; throw new Error('unexpected dense work'); };
    const dense = new ActiveCompanyDenseSearchService(s.scope, { resolveDenseReadiness: never,
      retrieveDenseFilingChunks: never }, { embedBatch: never }, undefined, undefined, MIXED_RETRIEVAL_SCOPE_BINDING);
    await assert.rejects(dense.search({ ...COMPANY, query: 'synthetic', denseProfileId: FILING_DENSE_PROFILES.openAiSmall1536.profileId }),
      { code: 'FILING_DENSE_SCOPE_COMPATIBILITY_NOT_APPROVED' });
    assert.equal(calls, 0);
  });

  await t.test('durable unmatched NULL pair, no-op, exact constraints and unsafe down guard', async () => {
    await clearPersistence(pool);
    const d = await document(pool, receipt(20), false, COMPANY, false);
    // Negative fixture: a valid persisted representation outside supported schema pins.
    await pool.query("UPDATE filing_intelligence.filing_document SET canonical_schema_version='2' WHERE id=$1", [d.documentId]);
    await pool.query(`UPDATE filing_intelligence.filing_document_representation_manifest m
      SET representation_fingerprint=c.representation_fingerprint
      FROM filing_intelligence.compute_filing_representation_manifest($1) c WHERE m.document_id=$1`, [d.documentId]);
    const e = services(pool).eligibility;
    const result = await e.evaluateDocumentEligibility(d.documentId, V2.policyId);
    assert.equal(result.status, 'ineligible'); assert.equal(result.reasonCode, 'representation_policy_mismatch');
    assert.equal(result.representationPolicyId, null); assert.equal(result.representationPolicyFingerprint, null);
    assert.equal((await e.evaluateDocumentEligibility(d.documentId, V2.policyId)).persistenceStatus, 'already_evaluated');
    for (const reason of ['lexical_generation_missing', 'lexical_generation_not_ready', 'receipt_quarantined']) {
      await assert.rejects(pool.query('UPDATE filing_intelligence.filing_retrieval_eligibility SET reason_code=$2 WHERE document_id=$1', [d.documentId, reason]), { code: '23514' });
    }
    await assert.rejects(pool.query("UPDATE filing_intelligence.filing_retrieval_eligibility SET status='eligible', reason_code='eligible' WHERE document_id=$1", [d.documentId]), { code: '23514' });
    await assert.rejects(pool.query('UPDATE filing_intelligence.filing_retrieval_eligibility SET retrieval_policy_id=$2 WHERE document_id=$1', [d.documentId, V1.policyId]), { code: '23514' });
    await assert.rejects(pool.query('UPDATE filing_intelligence.filing_retrieval_eligibility SET representation_policy_id=$2 WHERE document_id=$1', [d.documentId, FILING_REPRESENTATION_POLICY.policyId]), { code: '23514' });
    const before = await snapshot(pool);
    await assert.rejects(runMigrations('down', url, true, true));
    assert.equal(await latest(pool), MIGRATION);
    assert.equal(await snapshot(pool), before);
  });

  await t.test('generation missing/not-ready retains matched policy and ambiguity never selects a preferred representation', async () => {
    await clearPersistence(pool);
    const d = await root(pool, 30, true, COMPANY, false);
    const s = services(pool);
    let result = await s.eligibility.evaluateDocumentEligibility(d.documentId, V2.policyId);
    assert.equal(result.reasonCode, 'lexical_generation_missing');
    assert.equal(result.representationPolicyId, LEGACY_FILING_REPRESENTATION_POLICY.policyId);
    assert.equal((await activate(pool, d.number)).status, 'candidate_not_ready');
    await s.lexical.indexFilingDocumentLexically(d.documentId);
    await pool.query("UPDATE filing_intelligence.filing_lexical_generation SET status='building', completed_at=NULL WHERE document_id=$1", [d.documentId]);
    result = await s.eligibility.evaluateDocumentEligibility(d.documentId, V2.policyId);
    assert.equal(result.reasonCode, 'lexical_generation_not_ready'); assert.ok(result.representationPolicyId);
    await pool.query("UPDATE filing_intelligence.filing_lexical_generation SET status='ready', completed_at=clock_timestamp() WHERE document_id=$1", [d.documentId]);
    await document(pool, d.number, false);
    await assert.rejects(activate(pool, d.number), { code: 'FILING_ACTIVATION_REPRESENTATION_AMBIGUOUS' });
    assert.equal((await s.scope.resolveCompany({ ...COMPANY, retrievalPolicyId: V2.policyId })).status, 'empty');
  });

  await t.test('same and different policy concurrency is idempotent and policy-scoped', async () => {
    await clearPersistence(pool);
    const d = await root(pool, 40);
    const results = await Promise.all([activate(pool, d.number), activate(pool, d.number), activate(pool, d.number, V1.policyId)]);
    assert.equal(results.filter(r => r.status === 'activated').length, 2);
    assert.equal(results.filter(r => r.status === 'already_current').length, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM filing_intelligence.filing_retrieval_activation_history')).rows[0].n, 2);
  });

  await t.test('provenance, manifest, generation, and authority drift fail the complete mixed scope', async t => {
    await clearPersistence(pool);
    const d1 = await root(pool, 50);
    const d2 = await root(pool, 51, true);
    await activate(pool, d1.number); await activate(pool, d2.number);
    const s = services(pool);
    const cases = [
      ["UPDATE filing_intelligence.filing_chunk SET content_hash=repeat('f',64) WHERE document_id=$1", d2.documentId],
      ["UPDATE filing_intelligence.filing_document SET decoding_profile_fingerprint=repeat('f',64) WHERE id=$1", d2.documentId],
      ["UPDATE filing_intelligence.filing_document SET canonical_utf8_hash=repeat('f',64) WHERE id=$1", d2.documentId],
      ["UPDATE filing_intelligence.filing_document_representation_manifest SET representation_fingerprint=repeat('f',64) WHERE document_id=$1", d2.documentId],
      ["UPDATE filing_intelligence.filing_lexical_generation SET lexical_fingerprint=repeat('f',64) WHERE document_id=$1", d2.documentId],
      ["UPDATE filing_intelligence.filing_lexical_generation SET chunk_count=chunk_count+1 WHERE document_id=$1", d2.documentId],
      ["UPDATE filing_intelligence.filing_retrieval_eligibility SET retrieval_policy_fingerprint=repeat('f',64) WHERE document_id=$1", d2.documentId],
      ["UPDATE filing_intelligence.filing_retrieval_eligibility SET eligibility_fingerprint=repeat('f',64) WHERE document_id=$1", d2.documentId],
      ["UPDATE filing_intelligence.filing_retrieval_activation SET activation_fingerprint=repeat('f',64) WHERE document_id=$1", d2.documentId],
    ];
    for (const [i, [sql, id]] of cases.entries()) await t.test(`fault ${i + 1}`, async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        if (sql!.includes('filing_document_representation_manifest')) {
          // Fault injection only: bypass the FK in this rolled-back test transaction.
          await c.query('SET LOCAL session_replication_role = replica');
        }
        await c.query(sql!, [id]);
        const scoped = new ActiveFilingScopeService(new ActiveFilingScopeRepository(c as unknown as Pool));
        await assert.rejects(scoped.resolveCompany({ ...COMPANY, retrievalPolicyId: V2.policyId }));
      } finally {
        try { await c.query('ROLLBACK'); } finally { c.release(); }
      }
      assert.equal((await s.scope.resolveCompany({ ...COMPANY, retrievalPolicyId: V2.policyId })).documentIds.length, 2);
    });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("UPDATE filing_intelligence.filing_document SET canonical_utf8_hash=repeat('f',64) WHERE id=$1", [d2.documentId]);
      await assert.rejects(s.eligibility.evaluateDocumentEligibilityWithClient(c, d2.documentId, V2.policyId),
        { code: 'FILING_ELIGIBILITY_REPRESENTATION_INTEGRITY_FAILURE' });
    } finally {
      try { await c.query('ROLLBACK'); } finally { c.release(); }
    }
  });

  await t.test('hold, stale resolution, legal veto and global 20/21 company bounds remain authoritative', async () => {
    await clearPersistence(pool);
    const first = await root(pool, 60, true); await activate(pool, first.number);
    const s = services(pool);
    const stale = await s.resolver.resolveCurrentEffectiveReceiptCandidate(family(first.number));
    await new FilingResolutionControlRepository(pool).setHold({ familyId: first.familyId,
      expectedRevision: null, reasonCode: 'emergency_hold', referenceHash: HASH });
    await assert.rejects(s.activation.apply({ retrievalPolicyId: V2.policyId, resolution: stale }),
      { code: 'FILING_ACTIVATION_STALE_RESOLUTION' });
    assert.equal((await s.scope.resolveCompany({ ...COMPANY, retrievalPolicyId: V2.policyId })).status, 'empty');
    assert.equal((await activate(pool, first.number)).status, 'deactivated');
    await clearPersistence(pool);
    for (let i = 0; i < 20; i++) {
      const d = await root(pool, 100 + i, i % 2 === 0); await activate(pool, d.number);
    }
    const other = await root(pool, 200, true, OTHER); await activate(pool, other.number, V2.policyId, OTHER);
    const twenty = await s.scope.resolveCompany({ ...COMPANY, retrievalPolicyId: V2.policyId });
    assert.equal(twenty.documentIds.length, 20); assert.ok(!twenty.documentIds.includes(other.documentId));
    await s.lineage.persistReceipt(metadata(receipt(100), COMPANY, 'withdrawn'));
    assert.equal((await s.scope.resolveCompany({ ...COMPANY, retrievalPolicyId: V2.policyId })).documentIds.length, 19);
    const extra = await root(pool, 120, true); await activate(pool, extra.number);
    await assert.rejects(s.scope.resolveCompany({ ...COMPANY, retrievalPolicyId: V2.policyId }),
      { code: 'FILING_ACTIVE_SCOPE_TOO_LARGE' });
  });

  await clearPersistence(pool);
  await runMigrations('down', url, true, true);
  await runMigrations('up', url, true, true);
  assert.equal(await latest(pool), MIGRATION);
});
