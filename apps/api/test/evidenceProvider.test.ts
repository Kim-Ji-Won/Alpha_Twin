import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { ArtifactManifest, PreservedEvidenceReader, PinnedClaimReader, readPinnedFile, claimTarget } from '../src/filingIntelligence/admission/artifactReader.js';
import { CurrentBindingReader } from '../src/filingIntelligence/admission/bindingReader.js';
import { PreservedAdmissionEvidenceProvider } from '../src/filingIntelligence/admission/evidenceProvider.js';
import { AdmissionGuard, AdmissionDenied } from '../src/filingIntelligence/admission/guard.js';
import { Binding, ADMISSION_POLICY, assessEvidence } from '../src/filingIntelligence/admission/policy.js';
import { EvidenceProviderError } from '../src/filingIntelligence/admission/providerErrors.js';
import { DECISION_RULE, EXTRACTION_RULE } from '../evaluation/filingDense/evidenceMapping/contracts.js';
import { sha256 } from '../evaluation/filingDense/evidenceMapping/input.js';
import { familyBaseFingerprint, lineageFingerprint } from '../src/filingIntelligence/lineage/fingerprints.js';
import { resolveVerifiedFamilyGraph } from '../src/filingIntelligence/resolution/resolver.js';
import { VerifiedFamilyGraphSnapshot } from '../src/filingIntelligence/resolution/contracts.js';
import { ActiveCompanyLexicalSearchService } from '../src/filingIntelligence/retrieval/activeCompanyLexicalSearchService.js';
import { FILING_RETRIEVAL_POLICY } from '../src/filingIntelligence/eligibility/policies.js';
import { evidence, scope, SYNTHETIC_NOW, H } from './fixtures/admission.js';
import { target } from './fixtures/evidenceMapping.js';
import { FilingRetrievalActivationService } from '../src/filingIntelligence/activation/filingRetrievalActivationService.js';
import type { FilingRetrievalActivationRepository } from '../src/filingIntelligence/activation/filingRetrievalActivationRepository.js';
import type { FilingEligibilityRepository } from '../src/filingIntelligence/eligibility/filingEligibilityRepository.js';
import type { VerifiedFilingGraphRepository } from '../src/filingIntelligence/resolution/graphRepository.js';
import { readBindingGraph } from '../src/filingIntelligence/resolution/graphRepository.js';

const policy = FILING_RETRIEVAL_POLICY;
const expired = new Date(Date.parse(SYNTHETIC_NOW) + 86400001).toISOString();
const graph: VerifiedFamilyGraphSnapshot = {
  databaseNow: SYNTHETIC_NOW, family: { id: '1', provider: 'opendart-fss', corpCode: target.corpCode,
    symbol: target.symbol, lineageRootReceiptId: '2', lineageRootReceiptNumber: target.receipt,
    status: 'verified', revision: '1', fingerprint: familyBaseFingerprint({ provider: 'opendart-fss',
      corpCode: target.corpCode, symbol: target.symbol, rootReceiptNumber: target.receipt }) },
  members: [{ role: 'root', source: 'trusted_backfill', membershipFingerprint: lineageFingerprint({
    familyRoot: target.receipt, receiptNumber: target.receipt, role: 'root', source: 'trusted_backfill' }),
    receipt: { id: '2', provider: 'opendart-fss', receiptNumber: target.receipt, corpCode: target.corpCode,
      symbol: target.symbol, legalStatus: 'reported_active', lineageStatus: 'resolved' } }], relations: [], manualControl: null,
};
const resolution = resolveVerifiedFamilyGraph(graph);
const binding: Binding = { provider: 'opendart-fss', receiptNumber: target.receipt, corpCode: target.corpCode,
  symbol: target.symbol, familyId: '1', lineageRootReceiptNumber: target.receipt, familyRevision: '1',
  familyFingerprint: graph.family.fingerprint, receiptId: '2', resolutionFingerprint: resolution.resolutionFingerprint,
  memberCount: '1', relationCount: '0', retrievalPolicyId: policy.policyId };

function fakeClient() {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const state = { alter: (_sql: string, rows: Record<string, unknown>[]) => rows,
    afterQuery: async () => {}, active: false, generationStatus: 'ready' as unknown };
  const client = { async query(sql: string, params?: unknown[]) {
    assert.match(sql.trim(), /^SELECT\b/); assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|COMMIT|ROLLBACK|TRUNCATE)\b/);
    calls.push({ sql, params });
    let rows: Record<string, unknown>[];
    if (sql.includes("current_setting('transaction_read_only')")) rows = [{ read_only: 'on', isolation: 'repeatable read' }];
    else if (sql.startsWith('SELECT clock_timestamp')) rows = [{ database_now: new Date(SYNTHETIC_NOW) }];
    else if (sql.includes('AS "documentId"')) rows = [{ documentId: params![0], representationFingerprint: H,
      manifest_version: 'filing-representation-manifest@1', canonical_schema_version: '1', parser_version: '1', chunker_version: '1',
      eligibilityRevision: '1', eligibilityFingerprint: H, representationPolicyId: policy.representationPolicyId,
      representationPolicyFingerprint: policy.representationPolicyFingerprint, lexicalGenerationId: '4', lexicalGenerationFingerprint: H,
      activationRevision: state.active ? '1' : null, activationFingerprint: state.active ? H : null,
      selectionMode: state.active ? 'automatic' : null, activated_at: state.active ? new Date(SYNTHETIC_NOW) : null,
      ...(sql.includes('g.status AS generation_status') ? { generation_status: state.generationStatus } : {}) }];
    else if (sql.includes('SELECT company_name')) rows = [{ company_name: target.companyName, filing_date: target.filingDate }];
    else if (sql.includes('FROM filing_intelligence.filing_receipt')) rows = [{ id: '2', provider: 'opendart-fss',
      receipt_number: target.receipt, corp_code: target.corpCode, symbol: target.symbol }];
    else if (sql.includes('FROM filing_intelligence.filing_report_family_member')) rows = [{ member_role: 'root',
      membership_source: 'trusted_backfill', membership_fingerprint: graph.members[0]!.membershipFingerprint,
      receipt_id: '2', provider: 'opendart-fss', receipt_number: target.receipt, corp_code: target.corpCode,
      symbol: target.symbol, legal_status: 'reported_active', lineage_status: 'resolved' }];
    else if (sql.includes('FROM filing_intelligence.filing_report_family')) rows = [{ id: '1', provider: 'opendart-fss',
      corp_code: target.corpCode, symbol: target.symbol, lineage_root_receipt_id: '2', family_status: 'verified',
      revision: '1', family_fingerprint: graph.family.fingerprint }];
    else if (sql.includes('FROM filing_intelligence.filing_correction_relation') || sql.includes('FROM filing_intelligence.filing_family_resolution_control')) rows = [];
    else throw new Error('UNEXPECTED_SQL');
    await state.afterQuery();
    return { rows: state.alter(sql, rows) };
  } } as unknown as PoolClient;
  return { client, state, calls };
}
async function fixture(t: { after: (fn: () => Promise<void>) => void },
  mutate: (m: ArtifactManifest) => void = () => {}) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'admission-reader-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = evidence(binding);
  const manifest: ArtifactManifest = { schema: 'admission-artifact-catalog@1', revision: 'synthetic-1',
    extractionRule: EXTRACTION_RULE, decisionRule: DECISION_RULE, target, finalQuery: 'requested', sources: [] };
  for (const [i, artifact] of original.artifacts.entries()) {
    const name = `source-${i}.${artifact.source.kind === 'viewer-main' ? 'html' : 'json'}`;
    await writeFile(path.join(root, name), artifact.bytes);
    manifest.sources.push({ name, revision: manifest.revision, source: structuredClone(artifact.source) });
  }
  mutate(manifest);
  const bytes = JSON.stringify(manifest);
  await writeFile(path.join(root, 'manifest.json'), bytes);
  const reference = { root, name: 'manifest.json', sha256: sha256(bytes) };
  const reader = new PreservedEvidenceReader(reference);
  async function claims(change: (r: Record<string, unknown>) => void = () => {}) {
    const artifact = await reader.read();
    const record: Record<string, unknown> = { schema: 'admission-claim-catalog@1', issuer: 'test-only-issuer',
      decision: 'accepted', revision: 'test-only-claim-1', artifactRevision: artifact.revision,
      target: claimTarget(binding), lineage: original.lineage };
    change(record);
    const claimBytes = JSON.stringify(record);
    await writeFile(path.join(root, 'claims.json'), claimBytes);
    return new PinnedClaimReader({ root, name: 'claims.json', sha256: sha256(claimBytes) }, 'test-only-issuer');
  }
  return { root, manifest, reference, reader, claims };
}
const fail = (code: string) => (e: unknown) => e instanceof EvidenceProviderError && e.code === code;

async function lexicalFixture(t: Parameters<typeof fixture>[0]) {
  const f = await fixture(t), db = fakeClient(); db.state.active = true;
  let queries = 0;
  const hook = { query: () => {} };
  const provider = new PreservedAdmissionEvidenceProvider(f.reader, new CurrentBindingReader(), {
    async withClient(_phase, fn) { return fn(db.client); },
  }, await f.claims());
  const service = ActiveCompanyLexicalSearchService.guarded({ async resolveCompany() { return scope(); } }, {
    async retrieveLexicalFilingChunks() { queries++; hook.query(); return []; },
  }, new AdmissionGuard(provider, { now: () => SYNTHETIC_NOW }));
  return { db, hook, queries: () => queries,
    search: () => service.search({ corpCode: target.corpCode, symbol: target.symbol, query: 'synthetic' }) };
}
for (const status of ['failed', 'building', null, undefined, 'invalid']) test(`F1 use rejects status ${String(status)} with same generation pin`, async t => {
  const h = await lexicalFixture(t); h.db.state.generationStatus = status;
  await assert.rejects(h.search(), e => e instanceof AdmissionDenied && e.reasons.includes('DB_BINDING_MISMATCH'));
  assert.equal(h.queries(), 0);
  const query = h.db.calls.find(c => c.sql.includes('AS "documentId"'))!;
  assert.match(query.sql, /g.status AS generation_status/);
  assert.match(query.sql, /g.document_id=d.id AND g.profile_id=\$7/);
  assert.deepEqual(query.params, ['3', '2', 'opendart-fss', target.corpCode, target.symbol, policy.policyId, policy.lexicalProfileId, '1']);
});
test('F1 ready uses exact generation and calls lexical dependency', async t => {
  const h = await lexicalFixture(t);
  assert.equal((await h.search()).status, 'no_matches'); assert.equal(h.queries(), 1);
});
for (const phase of ['before-query', 'after-query']) test(`F1 ready to failed ${phase}`, async t => {
  const h = await lexicalFixture(t); let reads = 0;
  h.db.state.alter = (sql, rows) => {
    if (sql.includes('AS "documentId"') && ++reads === 1 && phase === 'before-query') h.db.state.generationStatus = 'failed';
    return rows;
  };
  if (phase === 'after-query') h.hook.query = () => { h.db.state.generationStatus = 'failed'; };
  await assert.rejects(h.search(), AdmissionDenied);
  assert.equal(h.queries(), phase === 'after-query' ? 1 : 0);
});
for (const field of ['lexicalGenerationId', 'lexicalGenerationFingerprint']) test(`F1 ready does not replace mismatched ${field}`, async t => {
  const h = await lexicalFixture(t);
  h.db.state.alter = (sql, rows) => sql.includes('AS "documentId"')
    ? rows.map(row => ({ ...row, [field]: field.endsWith('Id') ? '99' : 'b'.repeat(64) })) : rows;
  await assert.rejects(h.search(), AdmissionDenied); assert.equal(h.queries(), 0);
});
for (const stale of [true, false]) test(`F2 family alias mutation preserves observed revision; stale=${stale}`, async t => {
  const f = await fixture(t), db = fakeClient(); let original: Record<string, unknown> | undefined;
  const newerGraph = structuredClone(graph); Object.assign(newerGraph.family, { revision: '2' });
  const newer = { ...binding, familyRevision: '2', resolutionFingerprint: resolveVerifiedFamilyGraph(newerGraph).resolutionFingerprint };
  db.state.alter = (sql, rows) => {
    if (sql.includes('FROM filing_intelligence.filing_report_family\n')) {
      original = rows[0]!; original.revision = '2';
    }
    if (sql.includes('FROM filing_intelligence.filing_report_family_member')) {
      assert.equal(original!.revision, '2'); original!.revision = '1'; original!.symbol = '999999';
    }
    return rows;
  };
  const claims = await f.claims(record => { if (!stale) record.target = claimTarget(newer); });
  const provider = new PreservedAdmissionEvidenceProvider(f.reader, new CurrentBindingReader(), undefined, claims);
  const guard = new AdmissionGuard(provider, { now: () => SYNTHETIC_NOW });
  if (stale) await assert.rejects(guard.inspect(binding, 'admission', db.client), AdmissionDenied);
  else {
    const result = await guard.inspect(newer, 'admission', db.client);
    original!.revision = '3';
    assert.equal(result.binding.familyRevision, '2'); assert.equal(result.binding.symbol, target.symbol);
  }
  assert.equal(original!.symbol, '999999'); assert.equal(Object.isFrozen(original), false);
});
test('F2 member row is copied before relation query and separate reads observe new revisions', async () => {
  const db = fakeClient(); let member: Record<string, unknown> | undefined;
  db.state.alter = (sql, rows) => {
    if (sql.includes('FROM filing_intelligence.filing_report_family_member')) member = rows[0]!;
    if (sql.includes('FROM filing_intelligence.filing_correction_relation')) member!.symbol = '999999';
    return rows;
  };
  const input = { provider: 'opendart-fss' as const, corpCode: target.corpCode, symbol: target.symbol, lineageRootReceiptNumber: target.receipt };
  const first = await readBindingGraph(db.client, input, '1');
  assert.equal(member!.symbol, '999999'); assert.equal(first.snapshot!.members[0]!.receipt.symbol, target.symbol);
  db.state.alter = (sql, rows) => sql.includes('FROM filing_intelligence.filing_report_family\n')
    ? rows.map(row => ({ ...row, revision: '2' })) : rows;
  assert.equal((await readBindingGraph(db.client, input, '1')).snapshot!.family.revision, '2');
  assert.equal(first.snapshot!.family.revision, '1');
});

test('duplicate graph root and corrupted graph fingerprint are not transport failures', async () => {
  const f = fakeClient();
  f.state.alter = (sql, rows) => sql.includes('FROM filing_intelligence.filing_receipt') ? [...rows, ...rows] : rows;
  await assert.rejects(new CurrentBindingReader().read(f.client, binding, target), fail('DB_CARDINALITY_INVALID'));
  f.state.alter = (sql, rows) => sql.includes('FROM filing_intelligence.filing_report_family\n')
    ? rows.map(row => ({ ...row, family_fingerprint: 'b'.repeat(64) })) : rows;
  await assert.rejects(new CurrentBindingReader().read(f.client, binding, target), fail('DB_BINDING_MISMATCH'));
});

test('reader preserves legacy/header phase and guard rejects without inventing body completion', async t => {
  const f = await fixture(t, m => {
    m.sources[0]!.source.request.provenance = 'legacy-collection-contract';
    m.sources[0]!.source.response.bodyReceivedAt = null;
  });
  const bundle = await f.reader.read();
  const result = assessEvidence({ ...bundle, binding, lineage: null, policyId: ADMISSION_POLICY.id,
    policyVersion: ADMISSION_POLICY.version, refresh: 'ok' }, binding, 'admission', SYNTHETIC_NOW);
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('LEGACY_PHASE_REJECTED'));
  assert.ok(result.reasons.includes('BODY_TIME_REQUIRED'));
  assert.ok(result.reasons.includes('ROOT_UNPROVEN'));
});

for (const kind of ['malformed', 'unsupported'] as const) test(`reader rejects ${kind} raw bytes`, async t => {
  const f = await fixture(t);
  const entry = f.manifest.sources[kind === 'malformed' ? 0 : 2]!;
  const bytes = kind === 'malformed' ? '{broken' : '<html>unsupported</html>';
  entry.source.rawBodySha256 = sha256(bytes);
  await writeFile(path.join(f.root, entry.name), bytes);
  const manifest = JSON.stringify(f.manifest);
  await writeFile(path.join(f.root, 'manifest.json'), manifest);
  const reader = new PreservedEvidenceReader({ ...f.reference, sha256: sha256(manifest) });
  await assert.rejects(reader.read(), fail(kind === 'malformed' ? 'ARTIFACT_MALFORMED' : 'ARTIFACT_UNSUPPORTED'));
});

for (const generation of ['ready', 'failed', 'building', 'missing'])
for (const expireAfterEvaluation of [false, true]) test(`actual provider activation finalization expiry=${expireAfterEvaluation} generation=${generation}`, async t => {
  const f = await fixture(t), pre = fakeClient(), tx = fakeClient();
  tx.state.generationStatus = generation === 'missing' ? null : generation;
  if (generation === 'missing') tx.state.alter = (sql, rows) => sql.includes('AS "documentId"')
    ? rows.map(row => ({ ...row, lexicalGenerationId: null, lexicalGenerationFingerprint: null })) : rows;
  const events: string[] = []; let time = SYNTHETIC_NOW;
  tx.state.afterQuery = async () => {
    if (tx.calls.at(-1)?.sql.includes('SELECT company_name')) events.push('tx-read');
  };
  const guard = new AdmissionGuard(new PreservedAdmissionEvidenceProvider(f.reader, new CurrentBindingReader(), {
    async withClient(_phase, read) { events.push('pre-read'); return read(pre.client); },
  }, await f.claims()), { now: () => time });
  const repository = {
    async transaction<T>(fn: (c: PoolClient) => Promise<T>) {
      events.push('begin');
      try { const result = await fn(tx.client); events.push('commit'); return result; }
      catch (e) { events.push('rollback'); throw e; }
    },
    async lockFamily(client: PoolClient) { assert.equal(client, tx.client); events.push('lock');
      return { id: '1', provider: 'opendart-fss', corpCode: target.corpCode, symbol: target.symbol, lineageRootReceiptNumber: target.receipt }; },
    async lockManualControl() {}, async lockCurrent() { return null; },
    async findCompatibleDocumentIds() { return ['3']; }, async lockCandidateDocuments() {},
    async stabilizeSelectedReceipt() {}, async writeTransition() { assert.fail('ineligible candidate must not activate'); },
  } as unknown as FilingRetrievalActivationRepository;
  const graphs = { async loadWithClient(client: PoolClient) { assert.equal(client, tx.client); return { snapshot: graph }; } } as unknown as VerifiedFilingGraphRepository;
  const eligibility = { async evaluateDocumentEligibilityWithClient(client: PoolClient) {
    assert.equal(client, tx.client); events.push('evaluate'); if (expireAfterEvaluation) time = expired;
    return { status: 'ineligible', receiptId: '2', documentId: '3', revision: '1', eligibilityFingerprint: H,
      representationPolicyId: policy.representationPolicyId, representationPolicyFingerprint: policy.representationPolicyFingerprint,
      representationFingerprint: H, lexicalGenerationId: '4', lexicalGenerationFingerprint: H };
  } } as unknown as FilingEligibilityRepository;
  const service = FilingRetrievalActivationService.guarded(repository, graphs, eligibility, guard);
  const call = service.apply({ resolution, retrievalPolicyId: policy.policyId });
  if (expireAfterEvaluation) { await assert.rejects(call, AdmissionDenied); assert.ok(events.includes('rollback')); }
  else assert.equal((await call).status, 'candidate_not_ready');
  assert.equal(events.includes('commit'), !expireAfterEvaluation);
  assert.ok(events.indexOf('pre-read') < events.indexOf('begin'));
  assert.ok(events.indexOf('tx-read') > events.indexOf('lock'));
  assert.ok(events.lastIndexOf('tx-read') > events.indexOf('evaluate'));
  assert.equal(events.filter(e => e === 'pre-read').length, 1);
});

test('actual files: same N/Y bytes retain distinct contexts and returned bytes are a verified snapshot', async t => {
  const f = await fixture(t), b = await f.reader.read();
  assert.equal(b.artifacts.length, 3);
  assert.deepEqual(b.artifacts[0]!.bytes, b.artifacts[1]!.bytes);
  assert.notEqual(b.artifacts[0]!.source.kind, b.artifacts[1]!.source.kind);
  await writeFile(path.join(f.root, f.manifest.sources[0]!.name), 'changed');
  assert.equal(sha256(b.artifacts[0]!.bytes), b.artifacts[0]!.source.rawBodySha256);
  await assert.rejects(f.reader.read(), fail('ARTIFACT_HASH_MISMATCH'));
});
for (const [name, mutation, code] of [
  ['revision-mix', (m: ArtifactManifest) => { m.sources[0]!.revision = 'other'; }, 'ARTIFACT_CONTEXT_MISMATCH'],
  ['request', (m: ArtifactManifest) => { m.sources[0]!.source.request.parameters.last_reprt_at = 'Y'; }, 'ARTIFACT_CONTEXT_MISMATCH'],
  ['identity', (m: ArtifactManifest) => { m.sources[0]!.source.target = { ...target, symbol: '999999' }; }, 'ARTIFACT_CONTEXT_MISMATCH'],
  ['rule', (m: ArtifactManifest) => { m.extractionRule = 'other' as never; }, 'ARTIFACT_SCHEMA_INVALID'],
  ['alias', (m: ArtifactManifest) => { const a = structuredClone(m.sources[0]!); a.source.id = 'alias'; m.sources.push(a); }, 'ARTIFACT_DUPLICATE'],
  ['traversal', (m: ArtifactManifest) => { m.sources[0]!.name = '../outside.json'; }, 'ARTIFACT_PATH_REJECTED'],
  ['absolute-path', (m: ArtifactManifest) => { m.sources[0]!.name = '/private/tmp/outside.json'; }, 'ARTIFACT_PATH_REJECTED'],
] as const) test(`reader rejects ${name}`, async t => {
  const f = await fixture(t, mutation); await assert.rejects(f.reader.read(), fail(code));
});
test('reader rejects symlink and missing source distinctly', async t => {
  const f = await fixture(t), file = path.join(f.root, f.manifest.sources[0]!.name);
  await rm(file); await assert.rejects(f.reader.read(), fail('ARTIFACT_MISSING'));
  await symlink(path.join(f.root, f.manifest.sources[1]!.name), file);
  await assert.rejects(f.reader.read(), fail('ARTIFACT_PATH_REJECTED'));
});
test('malformed manifest is not an empty bundle', async t => {
  const f = await fixture(t); await writeFile(path.join(f.root, 'bad.json'), '{');
  await assert.rejects(new PreservedEvidenceReader({ root: f.root, name: 'bad.json', sha256: sha256('{') }).read(), fail('ARTIFACT_SCHEMA_INVALID'));
});
test('oversized pinned file rejected without unbounded reading', async t => {
  const f = await fixture(t), bytes = Buffer.alloc(2_000_001);
  await writeFile(path.join(f.root, 'large.json'), bytes);
  await assert.rejects(readPinnedFile({ root: f.root, name: 'large.json', sha256: sha256(bytes) }), fail('ARTIFACT_PATH_REJECTED'));
});
test('default unavailable claims never become accepted by policy or Y positive', async t => {
  const f = await fixture(t), db = fakeClient();
  const provider = new PreservedAdmissionEvidenceProvider(f.reader, new CurrentBindingReader(), undefined);
  await assert.rejects(provider.load(binding, db.client), fail('CLAIM_UNAVAILABLE'));
});
for (const field of ['decision', 'issuer', 'artifactRevision', 'target'] as const) test(`claim ${field} mismatch is denied`, async t => {
  const f = await fixture(t), claims = await f.claims(r => { r[field] = field === 'target' ? { ...claimTarget(binding), familyRevision: '2' } : 'pending'; });
  await assert.rejects(claims.read(binding, (await f.reader.read()).revision), fail('CLAIM_BINDING_MISMATCH'));
});
test('accepted catalog mutation fails original pin instead of silently changing revision', async t => {
  const f = await fixture(t), claims = await f.claims();
  await writeFile(path.join(f.root, 'claims.json'), '{}');
  await assert.rejects(claims.read(binding, (await f.reader.read()).revision), fail('ARTIFACT_HASH_MISMATCH'));
});
test('real adapter SELECT uses supplied executor, parameter values and no transaction ownership', async () => {
  const db = fakeClient(); const b = await new CurrentBindingReader().read(db.client, binding, target);
  assert.equal(b.familyFingerprint, binding.familyFingerprint);
  assert.ok(db.calls.some(c => c.params?.includes(target.receipt)));
  assert.ok(db.calls.every(c => !c.sql.includes(target.receipt)));
});
for (const [name, alter, code] of [
  ['missing', (_sql: string, _rows: Record<string, unknown>[]) => [], 'DB_ROW_MISSING'],
  ['duplicate', (_sql: string, rows: Record<string, unknown>[]) => [...rows, ...rows], 'DB_CARDINALITY_INVALID'],
  ['null', (_sql: string, rows: Record<string, unknown>[]) => rows.map(r => ({ ...r, company_name: null })), 'DB_BINDING_MISMATCH'],
  ['type', (_sql: string, rows: Record<string, unknown>[]) => rows.map(r => ({ ...r, company_name: 1 })), 'DB_BINDING_MISMATCH'],
] as const) test(`binding reader ${name}`, async () => {
  const db = fakeClient(); db.state.alter = (sql, rows) => sql.includes('SELECT company_name') ? alter(sql, rows) : rows;
  await assert.rejects(new CurrentBindingReader().read(db.client, binding, target), fail(code));
});
test('query failure redacts raw message and binding revision mismatch fails', async () => {
  const db = fakeClient();
  await assert.rejects(new CurrentBindingReader().read(db.client, { ...binding, familyRevision: '2' }, target), fail('DB_BINDING_MISMATCH'));
  db.state.afterQuery = async () => { throw new Error('credential-bearing-error'); };
  await assert.rejects(new CurrentBindingReader().read(db.client, binding, target), e => fail('DB_QUERY_FAILED')(e) && !String(e).includes('credential'));
});
test('provider distinguishes preflight/use leases from caller transaction; final write expiry stays denied', async t => {
  const f = await fixture(t), pre = fakeClient(), tx = fakeClient(), phases: string[] = [];
  let time = SYNTHETIC_NOW;
  const provider = new PreservedAdmissionEvidenceProvider(f.reader, new CurrentBindingReader(), {
    async withClient(phase, fn) { phases.push(phase); return fn(pre.client); },
  }, await f.claims());
  const guard = new AdmissionGuard(provider, { now: () => time }), session = guard.session();
  await session.check(binding, 'admission');
  const preCalls = pre.calls.length;
  await session.beforeWrite({ ...binding, documentId: '3' }, tx.client);
  assert.equal(pre.calls.length, preCalls); assert.ok(tx.calls.length > 0);
  time = expired;
  await assert.rejects(session.finalizeWrites(tx.client), e => e instanceof AdmissionDenied && e.reasons.includes('EXPIRED'));
  assert.deepEqual(phases, ['preflight']);
});
test('missing and wrong read context fail closed', async t => {
  const f = await fixture(t), claims = await f.claims(), db = fakeClient();
  await assert.rejects(new PreservedAdmissionEvidenceProvider(f.reader, new CurrentBindingReader(), undefined, claims).load(binding), fail('DB_CONTEXT_REQUIRED'));
  db.state.alter = (sql, rows) => sql.includes('current_setting') ? [{ read_only: 'off', isolation: 'read committed' }] : rows;
  const provider = new PreservedAdmissionEvidenceProvider(f.reader, new CurrentBindingReader(), { async withClient(_phase, fn) { return fn(db.client); } }, claims);
  await assert.rejects(provider.load(binding), fail('DB_CONTEXT_INVALID'));
});
test('real provider/guard/lexical service positive, then authoritative drift blocks next query', async t => {
  const f = await fixture(t), db = fakeClient(); db.state.active = true;
  const phases: string[] = [];
  const provider = new PreservedAdmissionEvidenceProvider(f.reader, new CurrentBindingReader(), {
    async withClient(phase, fn) { phases.push(phase); return fn(db.client); },
  }, await f.claims());
  const active = scope(); let queries = 0;
  const service = ActiveCompanyLexicalSearchService.guarded({ async resolveCompany() { return active; } }, {
    async retrieveLexicalFilingChunks() { queries++; return []; },
  }, new AdmissionGuard(provider, { now: () => SYNTHETIC_NOW }));
  assert.equal((await service.search({ corpCode: target.corpCode, symbol: target.symbol, query: 'synthetic' })).status, 'no_matches');
  assert.equal(queries, 1); assert.ok(phases.every(p => p === 'use'));
  db.state.alter = (sql, rows) => sql.includes('AS "documentId"') ? rows.map(r => ({ ...r, activationRevision: '2' })) : rows;
  await assert.rejects(service.search({ corpCode: target.corpCode, symbol: target.symbol, query: 'synthetic' }), AdmissionDenied);
  assert.equal(queries, 1);
});
test('time is checked after awaited provider and two sessions do not share context', async t => {
  const f = await fixture(t), claims = await f.claims(), a = fakeClient(), b = fakeClient();
  let time = SYNTHETIC_NOW;
  const provider = new PreservedAdmissionEvidenceProvider(f.reader, new CurrentBindingReader(), undefined, claims);
  const guard = new AdmissionGuard(provider, { now: () => time });
  await Promise.all([guard.session().check(binding, 'admission', a.client), guard.session().check(binding, 'admission', b.client)]);
  assert.equal(a.calls.length, b.calls.length);
  a.state.afterQuery = async () => { time = expired; };
  await assert.rejects(guard.session().check(binding, 'admission', a.client), e => e instanceof AdmissionDenied && e.reasons.includes('EXPIRED'));
});
