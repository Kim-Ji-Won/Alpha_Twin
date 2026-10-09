import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../src/infrastructure/database/transaction.js';
import { AdmissionDenied, AdmissionGuard } from '../src/filingIntelligence/admission/guard.js';
import { FilingRetrievalActivationService } from '../src/filingIntelligence/activation/filingRetrievalActivationService.js';
import { FilingRetrievalActivationRepository } from '../src/filingIntelligence/activation/filingRetrievalActivationRepository.js';
import type { FilingRetrievalActivationState } from '../src/filingIntelligence/activation/contracts.js';
import { activationFingerprint } from '../src/filingIntelligence/activation/fingerprints.js';
import { FilingEligibilityRepository } from '../src/filingIntelligence/eligibility/filingEligibilityRepository.js';
import { FILING_RETRIEVAL_POLICY } from '../src/filingIntelligence/eligibility/policies.js';
import { VerifiedFilingGraphRepository } from '../src/filingIntelligence/resolution/graphRepository.js';
import { VerifiedFamilyGraphSnapshot } from '../src/filingIntelligence/resolution/contracts.js';
import { resolveVerifiedFamilyGraph } from '../src/filingIntelligence/resolution/resolver.js';
import { familyBaseFingerprint, lineageFingerprint } from '../src/filingIntelligence/lineage/fingerprints.js';
import { ActiveCompanyLexicalSearchService } from '../src/filingIntelligence/retrieval/activeCompanyLexicalSearchService.js';
import { ActiveCompanyDenseSearchService } from '../src/filingIntelligence/retrieval/activeCompanyDenseSearchService.js';
import { FILING_DENSE_PROFILES } from '../src/filingIntelligence/dense/profile.js';
import { target } from './fixtures/evidenceMapping.js';
import { evidence, fakeGuard, scope, H, SYNTHETIC_NOW } from './fixtures/admission.js';

const expired = new Date(Date.parse(SYNTHETIC_NOW) + 86400001).toISOString();
const policy = FILING_RETRIEVAL_POLICY;
function writerHarness() {
  const calls: string[] = [];
  let time = SYNTHETIC_NOW, revision = 'synthetic-revision-1';
  let deny = false, current: FilingRetrievalActivationState | null = null, documentId = '3';
  let eligible = true, loads = 0, extraDocument = false;
  const hooks = { lock: () => {}, evaluate: () => {}, write: () => {},
    load: (_e: ReturnType<typeof evidence>, _call: number) => {} };
  const graph: VerifiedFamilyGraphSnapshot = {
    databaseNow: SYNTHETIC_NOW,
    family: { id: '1', provider: 'opendart-fss', corpCode: target.corpCode, symbol: target.symbol,
      lineageRootReceiptId: '2', lineageRootReceiptNumber: target.receipt, status: 'verified', revision: '1',
      fingerprint: familyBaseFingerprint({ provider: 'opendart-fss', corpCode: target.corpCode, symbol: target.symbol, rootReceiptNumber: target.receipt }) },
    members: [{ role: 'root', source: 'manual_verified', membershipFingerprint: lineageFingerprint({
      familyRoot: target.receipt, receiptNumber: target.receipt, role: 'root', source: 'manual_verified' }),
      receipt: { id: '2', provider: 'opendart-fss', receiptNumber: target.receipt, corpCode: target.corpCode,
        symbol: target.symbol, legalStatus: 'reported_active', lineageStatus: 'resolved' } }],
    relations: [], manualControl: null,
  };
  const client = { async query(sql: string) { calls.push(sql);
    return { rows: sql.startsWith('SELECT clock') ? [{ database_now: new Date(SYNTHETIC_NOW) }] : [] }; }, release() { calls.push('release'); } } as unknown as PoolClient;
  const pool = { async connect() { calls.push('connect'); return client; } } as unknown as Pool;
  const repository = {
    async transaction<T>(fn: (c: PoolClient) => Promise<T>) { const saved = current;
      try { return await withTransaction(pool, fn); } catch (e) { current = saved; throw e; } },
    async lockFamily() { calls.push('lock'); hooks.lock(); return { id: '1', provider: 'opendart-fss', corpCode: target.corpCode,
      symbol: target.symbol, lineageRootReceiptNumber: target.receipt }; },
    async lockManualControl() { calls.push('control'); }, async lockCurrent() { return current; },
    async findCompatibleDocumentIds() { return extraDocument ? [documentId, '31'] : [documentId]; }, async lockCandidateDocuments() { calls.push('documents'); },
    async stabilizeSelectedReceipt() { calls.push('receipt-lock'); },
    async writeTransition(_client: PoolClient, input: { state: FilingRetrievalActivationState }) {
      calls.push('write'); hooks.write(); current = input.state; return input.state;
    },
  } as unknown as FilingRetrievalActivationRepository;
  const graphs = { async loadWithClient() { calls.push('graph'); return { snapshot: graph }; } } as unknown as VerifiedFilingGraphRepository;
  const eligibility = { async evaluateDocumentEligibilityWithClient() { calls.push('eligibility-write'); hooks.evaluate(); return {
    status: eligible ? 'eligible' : 'ineligible', receiptId: '2', documentId, revision: '1', eligibilityFingerprint: H,
    representationPolicyId: policy.representationPolicyId, representationPolicyFingerprint: policy.representationPolicyFingerprint,
    representationFingerprint: H, lexicalGenerationId: '4', lexicalGenerationFingerprint: H,
  }; } } as unknown as FilingEligibilityRepository;
  const guard = new AdmissionGuard({ async load(b, suppliedClient) { calls.push(suppliedClient ? 'guard-tx' : 'guard-pre');
    const e = evidence(b); if (deny) e.lineage = null; e.revision = revision; hooks.load(e, ++loads); return e;
  } }, { now: () => time });
  const service = FilingRetrievalActivationService.guarded(repository, graphs, eligibility, guard);
  const input = () => ({ resolution: resolveVerifiedFamilyGraph(graph), retrievalPolicyId: policy.policyId });
  return { calls, graph, hooks, service, input,
    expire() { time = expired; }, revise() { revision = 'synthetic-revision-2'; }, deny() { deny = true; },
    async seed() { await service.apply(input()); calls.length = 0; },
    replaceDocument() { documentId = '30'; }, current: () => current,
    ineligible() { eligible = false; }, multipleDocuments() { extraDocument = true; },
    async seedInactive() {
      await service.apply(input());
      const { activationFingerprint: _hash, activationRevision: _revision, activatedAt: _at,
        stateChangedAt: _changed, createdAt: _created, updatedAt: _updated, ...base } = current!;
      const inactive = { ...base, status: 'inactive' as const, receiptId: null, documentId: null,
        selectionMode: 'none' as const, eligibilityRevision: null, eligibilityFingerprint: null,
        representationPolicyId: null, representationPolicyFingerprint: null, representationFingerprint: null,
        lexicalGenerationId: null, lexicalGenerationFingerprint: null };
      current = { ...current!, ...inactive, activatedAt: null, activationFingerprint: activationFingerprint(inactive) };
      calls.length = 0;
    } };
}
test('guarded writer synthetic positive uses existing transaction, eligibility and transition', async () => {
  const h = writerHarness(); const r = await h.service.apply(h.input());
  assert.equal(r.status, 'activated'); assert.equal(h.calls.filter(c => c === 'COMMIT').length, 1);
  assert.ok(h.calls.indexOf('guard-pre') < h.calls.indexOf('BEGIN'));
  assert.ok(h.calls.indexOf('guard-tx') > h.calls.indexOf('lock'));
  assert.ok(h.calls.indexOf('guard-tx') < h.calls.indexOf('eligibility-write'));
  assert.ok(h.calls.lastIndexOf('guard-tx') > h.calls.indexOf('write'));
  assert.ok(h.calls.lastIndexOf('guard-tx') < h.calls.indexOf('COMMIT'));
});
test('guarded writer initial refusal never starts repository transaction', async () => {
  const h = writerHarness(); h.deny(); await assert.rejects(h.service.apply(h.input()), AdmissionDenied);
  assert.equal(h.calls.includes('connect'), false); assert.equal(h.calls.includes('write'), false);
});
for (const fault of ['expire', 'revision'] as const) test(`guarded writer lock wait ${fault} blocks first write and rolls back`, async () => {
  const h = writerHarness(); h.hooks.lock = () => fault === 'expire' ? h.expire() : h.revise();
  await assert.rejects(h.service.apply(h.input()), AdmissionDenied);
  assert.equal(h.calls.includes('eligibility-write'), false); assert.equal(h.calls.includes('write'), false);
  assert.equal(h.calls.includes('COMMIT'), false); assert.equal(h.calls.includes('ROLLBACK'), true);
});
test('guarded writer eligibility write followed by expiry rolls back, no transition', async () => {
  const h = writerHarness(); h.hooks.evaluate = () => h.expire();
  await assert.rejects(h.service.apply(h.input()), AdmissionDenied);
  assert.ok(h.calls.includes('eligibility-write')); assert.equal(h.calls.includes('write'), false);
  assert.ok(h.calls.includes('ROLLBACK')); assert.equal(h.calls.includes('COMMIT'), false);
});
test('guarded writer final expiry after transition rolls back and returns no success', async () => {
  const h = writerHarness(); h.hooks.write = () => h.expire();
  await assert.rejects(h.service.apply(h.input()), AdmissionDenied);
  assert.ok(h.calls.includes('write')); assert.ok(h.calls.includes('ROLLBACK'));
  assert.equal(h.calls.includes('COMMIT'), false); assert.equal(h.current(), null);
});
test('guarded writer preserves stale resolution rejection', async () => {
  const h = writerHarness(), input = h.input(); input.resolution = { ...input.resolution, familyRevision: '99' };
  await assert.rejects(h.service.apply(input), (e: unknown) => (e as { code: string }).code === 'FILING_ACTIVATION_STALE_RESOLUTION');
  assert.equal(h.calls.includes('eligibility-write'), false); assert.equal(h.calls.includes('COMMIT'), false);
});
test('guarded writer already_current still checks final actual target', async () => {
  const h = writerHarness(); await h.seed();
  assert.equal((await h.service.apply(h.input())).status, 'already_current');
  assert.equal(h.calls.includes('write'), false); assert.ok(h.calls.lastIndexOf('guard-tx') < h.calls.indexOf('COMMIT'));
});
test('guarded writer replacement checks selected representation and switches atomically in fake transaction', async () => {
  const h = writerHarness(); await h.seed(); h.replaceDocument();
  const result = await h.service.apply(h.input()); assert.equal(result.status, 'switched');
  assert.equal(result.activation?.documentId, '30'); assert.equal(h.calls.filter(c => c === 'COMMIT').length, 1);
});
test('guarded writer retained_existing validates actual retained receipt, not null candidate', async () => {
  const h = writerHarness(); await h.seed();
  (h.graph.members[0]!.receipt as { legalStatus: string }).legalStatus = 'unknown';
  const input = h.input(); assert.equal(input.resolution.selectedReceiptId, null);
  assert.equal((await h.service.apply(input)).status, 'retained_existing');
  h.calls.length = 0; h.deny();
  await assert.rejects(h.service.apply(input), AdmissionDenied);
  assert.equal(h.calls.includes('eligibility-write'), false); assert.equal(h.calls.includes('COMMIT'), false);
});
test('guarded writer manual-selected uses same evidence/time checks', async () => {
  const h = writerHarness();
  const control = { familyId: '1', mode: 'select' as const, selectedReceiptId: '2', reasonCode: 'manual_verified_selection' as const,
    referenceHash: H, actorReferenceHash: H, expiresAt: null };
  (h.graph as { manualControl: unknown }).manualControl = { ...control, revision: '1', controlFingerprint: lineageFingerprint(control) };
  assert.equal(h.input().resolution.selectionMode, 'manual');
  assert.equal((await h.service.apply(h.input())).status, 'activated');
  h.expire(); await assert.rejects(h.service.apply(h.input()), AdmissionDenied);
});

function lexicalHarness(mutate: Parameters<typeof fakeGuard>[0] = () => {}) {
  let time = SYNTHETIC_NOW, queries = 0;
  const active = scope(), state = { onQuery: () => {}, candidates: [] as never[] };
  const g = fakeGuard(mutate, () => time);
  const service = ActiveCompanyLexicalSearchService.guarded({ async resolveCompany() { return active; } }, {
    async retrieveLexicalFilingChunks() { queries++; state.onQuery(); return state.candidates; },
  }, g.guard);
  return { service, active, state, queries: () => queries, expire: () => { time = expired; },
    input: { corpCode: target.corpCode, symbol: target.symbol, query: 'synthetic query' } };
}
test('guarded lexical synthetic positive calls downstream service', async () => {
  const h = lexicalHarness(); assert.equal((await h.service.search(h.input)).status, 'no_matches'); assert.equal(h.queries(), 1);
});
test('guarded lexical bad evidence prevents query', async () => {
  const h = lexicalHarness(e => { e.lineage = null; });
  await assert.rejects(h.service.search(h.input), AdmissionDenied); assert.equal(h.queries(), 0);
});
test('guarded lexical expiry between scope and query prevents query', async () => {
  const h = lexicalHarness((_e, call) => { if (call === 2) h.expire(); });
  await assert.rejects(h.service.search(h.input), AdmissionDenied); assert.equal(h.queries(), 0);
});
test('guarded lexical expiry during query prevents result return', async () => {
  const h = lexicalHarness(); h.state.onQuery = () => h.expire();
  await assert.rejects(h.service.search(h.input), AdmissionDenied); assert.equal(h.queries(), 1);
});
test('guarded lexical revision change during query prevents result reuse', async () => {
  let changed = false;
  const h = lexicalHarness(e => { if (changed) e.revision = 'new'; }); h.state.onQuery = () => { changed = true; };
  await assert.rejects(h.service.search(h.input), (e: unknown) => e instanceof AdmissionDenied && e.reasons.includes('EVIDENCE_REVISION_CHANGED'));
});
test('guarded lexical scope representation mutation during query is isolated', async () => {
  const h = lexicalHarness(); h.state.onQuery = () => {
    Object.assign(h.active, { entries: [{ ...h.active.entries[0]!, representationFingerprint: 'b'.repeat(64) }] });
  };
  const result = await h.service.search(h.input);
  assert.equal(h.active.entries[0]!.representationFingerprint, 'b'.repeat(64));
  assert.equal(result.scope.entries[0]!.representationFingerprint, H);
});
test('guarded lexical cached old scope fails authoritative binding mismatch', async () => {
  const h = lexicalHarness(e => { e.binding = { ...e.binding, representationFingerprint: 'b'.repeat(64) }; });
  await assert.rejects(h.service.search(h.input), AdmissionDenied); assert.equal(h.queries(), 0);
});
test('guarded lexical result cannot escape scope target', async () => {
  const h = lexicalHarness(); h.state.candidates = [{ documentId: '999', receiptNumber: target.receipt, corpCode: target.corpCode, symbol: target.symbol }] as never[];
  await assert.rejects(h.service.search(h.input), AdmissionDenied);
});
test('guarded lexical manual entry cannot bypass', async () => {
  const h = lexicalHarness(e => { e.lineage = null; }); Object.assign(h.active, { entries: [{ ...h.active.entries[0]!, selectionMode: 'manual' }] });
  await assert.rejects(h.service.search(h.input), AdmissionDenied); assert.equal(h.queries(), 0);
});
test('guarded lexical empty/veto scope retains typed meaning and query zero', async () => {
  const h = lexicalHarness(); Object.assign(h.active, { status: 'empty', entries: [], documentIds: [], vetoes: [{ reason: 'manual_hold' }] });
  const r = await h.service.search(h.input); assert.equal(r.status, 'scope_empty'); assert.equal(h.queries(), 0);
  assert.equal(r.scope.vetoes.length, 1);
});

function denseHarness() {
  let time = SYNTHETIC_NOW, queries = 0, embeddings = 0;
  const hooks = { query: () => {}, embedding: () => {} };
  const profile = FILING_DENSE_PROFILES.openAiSmall1536;
  const service = ActiveCompanyDenseSearchService.guarded({ async resolveCompany() { return scope(); } }, {
    async resolveDenseReadiness() { return { status: 'ready', denseProfileId: profile.profileId, denseProfileFingerprint: profile.profileFingerprint,
      generations: [{ documentId: '3', generationId: '4', generationFingerprint: H, representationFingerprint: H, inputManifestFingerprint: H, expectedVectorCount: 1 }] }; },
    async retrieveDenseFilingChunks() { queries++; hooks.query(); return []; },
  }, { async embedBatch(p, inputs) { embeddings++; hooks.embedding(); return { provider: 'openai', model: p.modelId, tokenCount: 1,
    vectors: [{ inputId: inputs[0]!.inputId, vector: [1, ...Array<number>(1535).fill(0)] }] }; } },
  fakeGuard(() => {}, () => time).guard, { count: () => 1 });
  return { service, hooks, expire: () => { time = expired; }, queries: () => queries, embeddings: () => embeddings,
    input: { corpCode: target.corpCode, symbol: target.symbol, query: 'synthetic', denseProfileId: profile.profileId } };
}
test('guarded dense synthetic path invokes fake embedding and fake repository', async () => {
  const h = denseHarness(); assert.equal((await h.service.search(h.input)).status, 'no_matches'); assert.equal(h.queries(), 1); assert.equal(h.embeddings(), 1);
});
test('guarded dense expiry during embedding blocks vector query', async () => {
  const h = denseHarness(); h.hooks.embedding = () => h.expire();
  await assert.rejects(h.service.search(h.input), AdmissionDenied); assert.equal(h.queries(), 0);
});
test('guarded dense expiry during query blocks result return', async () => {
  const h = denseHarness(); h.hooks.query = () => h.expire();
  await assert.rejects(h.service.search(h.input), AdmissionDenied); assert.equal(h.queries(), 1);
});

for (const state of ['null', 'inactive'] as const) {
  for (const fault of ['expiry', 'revision', 'binding'] as const) {
    test(`F1 ${state} ineligible ${fault} rolls back after one evaluation write`, async () => {
      const h = writerHarness(); if (state === 'inactive') await h.seedInactive(); h.ineligible();
      let evaluated = false, finalChecks = 0;
      h.hooks.evaluate = () => { evaluated = true; if (fault === 'expiry') h.expire(); if (fault === 'revision') h.revise(); };
      h.hooks.load = e => { if (evaluated) { finalChecks++; if (fault === 'binding') e.binding = { ...e.binding, documentId: '999' }; } };
      await assert.rejects(h.service.apply(h.input()), AdmissionDenied);
      assert.equal(h.calls.filter(c => c === 'eligibility-write').length, 1);
      assert.equal(h.calls.includes('COMMIT'), false); assert.equal(h.calls.includes('ROLLBACK'), true);
      assert.ok(finalChecks > 0);
    });
  }
  test(`F1 valid ${state} ineligible preserves candidate_not_ready`, async () => {
    const h = writerHarness(); if (state === 'inactive') await h.seedInactive(); h.ineligible();
    const r = await h.service.apply(h.input()); assert.equal(r.status, 'candidate_not_ready');
    assert.equal(r.activation?.status ?? null, state === 'null' ? null : 'inactive');
    assert.equal(h.calls.filter(c => c === 'eligibility-write').length, 1);
    assert.equal(h.calls.filter(c => c === 'COMMIT').length, 1);
    assert.ok(h.calls.lastIndexOf('guard-tx') > h.calls.indexOf('eligibility-write'));
  });
}
for (const fault of ['expiry', 'revision'] as const) test(`F1 final provider await ${fault} blocks commit`, async () => {
  const h = writerHarness(); h.ineligible(); let evaluated = false, injected = false;
  h.hooks.evaluate = () => { evaluated = true; };
  h.hooks.load = e => { if (evaluated) { injected = true; if (fault === 'expiry') h.expire(); else e.revision = 'changed'; } };
  await assert.rejects(h.service.apply(h.input()), AdmissionDenied);
  assert.equal(injected, true); assert.equal(h.calls.includes('COMMIT'), false); assert.ok(h.calls.includes('ROLLBACK'));
});
test('F1 final validation retains every evaluated document binding', async () => {
  const h = writerHarness(); h.ineligible(); h.multipleDocuments(); let evaluations = 0;
  const finalDocuments: string[] = []; h.hooks.evaluate = () => { evaluations++; };
  h.hooks.load = e => { if (evaluations === 2) finalDocuments.push(e.binding.documentId!); };
  assert.equal((await h.service.apply(h.input())).status, 'candidate_not_ready');
  assert.deepEqual(finalDocuments, ['3', '31']);
});

for (const call of [1, 2, 3]) for (const mutation of ['array', 'field', 'revision'] as const) {
  test(`F3 lexical provider await ${call} ${mutation} uses isolated snapshot`, async () => {
    let injected = false;
    const h = lexicalHarness((_e, n) => { if (n === call) {
      injected = true;
      if (mutation === 'array') Object.assign(h.active, { entries: [{ ...h.active.entries[0]!, representationFingerprint: 'b'.repeat(64) }] });
      else Object.assign(h.active.entries[0]!, mutation === 'field'
        ? { representationFingerprint: 'b'.repeat(64) } : { eligibilityRevision: '999' });
    } });
    const r = await h.service.search(h.input); assert.equal(injected, true);
    assert.equal(r.scope.entries[0]!.representationFingerprint, H); assert.equal(r.scope.entries[0]!.eligibilityRevision, '1');
    assert.equal(Object.isFrozen(h.active), false); assert.equal(Object.isFrozen(h.active.entries[0]), false);
    Object.assign(h.active.entries[0]!, { activationRevision: '888' });
    assert.equal(r.scope.entries[0]!.activationRevision, '1');
    assert.equal(h.queries(), 1);
  });
}

function densePlanHarness() {
  const active = scope(), profile = FILING_DENSE_PROFILES.openAiSmall1536;
  const plan = { status: 'ready' as const, denseProfileId: profile.profileId, denseProfileFingerprint: profile.profileFingerprint,
    generations: [{ documentId: '3', generationId: '40', generationFingerprint: H,
      representationFingerprint: H, inputManifestFingerprint: H, expectedVectorCount: 1 }] };
  let embeddings = 0, queries = 0, loads = 0;
  const hooks = { load: (_n: number) => {}, embedding: () => {}, query: () => {} };
  const candidate = { documentId: '3', chunkRowId: '5', chunkId: 'synthetic', generationId: '40', generationFingerprint: H,
    provider: 'opendart-fss', receiptNumber: target.receipt, corpCode: target.corpCode, symbol: target.symbol,
    sectionPath: [], ordinal: 0, sourceText: 'synthetic', retrievalText: 'synthetic', locator: {}, contentHash: H,
    parserVersion: 'synthetic', chunkerVersion: 'synthetic', denseProfileId: profile.profileId, denseRank: 1, denseSimilarity: 1 };
  const state = { candidates: [] as typeof candidate[], queried: '' };
  const service = ActiveCompanyDenseSearchService.guarded({ async resolveCompany() { return active; } }, {
    async resolveDenseReadiness() { return plan; },
    async retrieveDenseFilingChunks(input) { queries++; state.queried = input.generations[0]!.representationFingerprint; hooks.query(); return state.candidates; },
  }, { async embedBatch(p, inputs) { embeddings++; hooks.embedding(); return { provider: 'openai', model: p.modelId, tokenCount: 1,
    vectors: [{ inputId: inputs[0]!.inputId, vector: [1, ...Array<number>(1535).fill(0)] }] }; } },
  fakeGuard((_e, n) => { loads = n; hooks.load(n); }).guard, { count: () => 1 });
  return { active, plan, hooks, candidate, state, service, embeddings: () => embeddings, queries: () => queries, loads: () => loads,
    input: { corpCode: target.corpCode, symbol: target.symbol, query: 'synthetic', denseProfileId: profile.profileId } };
}
for (const fault of ['mismatch', 'missing', 'duplicate', 'malformed'] as const) test(`F2 readiness ${fault} blocks embedding and query`, async () => {
  const h = densePlanHarness();
  if (fault === 'mismatch') h.plan.generations[0]!.representationFingerprint = 'b'.repeat(64);
  if (fault === 'missing') h.plan.generations = [];
  if (fault === 'duplicate') h.plan.generations.push({ ...h.plan.generations[0]! });
  if (fault === 'malformed') h.plan.generations[0]!.representationFingerprint = 'invalid';
  await assert.rejects(h.service.search(h.input)); assert.equal(h.embeddings(), 0); assert.equal(h.queries(), 0);
});
for (const matched of [false, true]) test(`F2 same representation ${matched ? 'matched' : 'no_matches'} preserves dense-domain IDs`, async () => {
  const h = densePlanHarness(); if (matched) h.state.candidates = [h.candidate];
  const r = await h.service.search(h.input); assert.equal(r.status, matched ? 'matched' : 'no_matches');
  assert.equal(h.state.queried, H); assert.equal(h.embeddings(), 1); assert.equal(h.queries(), 1);
});
for (const phase of ['readiness', 'embedding', 'query', 'last-provider'] as const) test(`F2/F3 ${phase} mutation never uses unchecked B`, async () => {
  const h = densePlanHarness(); let injected = false;
  const mutate = () => { injected = true; Object.assign(h.active.entries[0]!, { representationFingerprint: 'b'.repeat(64), eligibilityRevision: '2' });
    h.plan.generations[0]!.representationFingerprint = 'b'.repeat(64); };
  if (phase === 'embedding') h.hooks.embedding = mutate;
  if (phase === 'query') h.hooks.query = mutate;
  if (phase === 'readiness' || phase === 'last-provider') h.hooks.load = n => { if (n === (phase === 'readiness' ? 3 : 6)) mutate(); };
  const r = await h.service.search(h.input); assert.equal(injected, true);
  assert.equal(h.state.queried, H); assert.equal(r.scope.entries[0]!.representationFingerprint, H);
  assert.equal(r.generations[0]!.representationFingerprint, H);
  h.plan.generations[0]!.generationId = '999'; Object.assign(h.active.entries[0]!, { activationRevision: '999' });
  assert.equal(r.generations[0]!.generationId, '40'); assert.equal(r.scope.entries[0]!.activationRevision, '1');
});
test('F2 result must match the validated dense generation', async () => {
  const h = densePlanHarness(); h.state.candidates = [{ ...h.candidate, generationId: '999' }];
  await assert.rejects(h.service.search(h.input), AdmissionDenied); assert.equal(h.queries(), 1);
});
