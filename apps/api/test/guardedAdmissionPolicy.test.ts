import assert from 'node:assert/strict';
import test from 'node:test';
import { assessEvidence, AdmissionEvidence, assessObservations } from '../src/filingIntelligence/admission/policy.js';
import { AdmissionDenied, AdmissionGuard } from '../src/filingIntelligence/admission/guard.js';
import { extractObservation } from '../evaluation/filingDense/evidenceMapping/extract.js';
import { source, page, row, target } from './fixtures/evidenceMapping.js';
import { binding, evidence, fakeGuard, SYNTHETIC_NOW } from './fixtures/admission.js';

const at = (delta: number) => new Date(Date.parse(SYNTHETIC_NOW) + delta).toISOString();
const check = (e = evidence(), time = SYNTHETIC_NOW, op: 'admission' | 'use' = 'admission') => assessEvidence(e, binding, op, time);
test('guard policy synthetic positive is deterministic, immutable and bound, not simulation', () => {
  const e = evidence(), before = JSON.stringify(e), result = check(e);
  assert.equal(result.allowed, true); assert.equal(result.nextAction, 'admission');
  assert.equal(result.validUntil, at(86400000));
  assert.deepEqual(check(e), result); assert.equal(JSON.stringify(e), before);
  assert.equal(result.policy.version, '1'); assert.equal(result.observationTimes.length, 3);
});
for (const delta of [86399999, 86400000, 86400001]) test(`guard Y age boundary ${delta}`, () => {
  assert.equal(check(evidence(), at(delta)).allowed, delta <= 86400000);
});
for (const delta of [899999, 900000, 900001]) test(`guard skew boundary ${delta}`, () => {
  const e = evidence(); e.artifacts[0]!.source.request.startedAt = at(-delta);
  e.artifacts[0]!.source.response.headersObservedAt = at(-delta);
  e.artifacts[0]!.source.response.bodyReceivedAt = at(-delta);
  assert.equal(check(e).allowed, delta <= 900000);
});
test('guard age is Y only, not all sources age', () => {
  const e = evidence(); const n = e.artifacts[0]!.source;
  n.request.startedAt = at(-900000); n.response.headersObservedAt = at(-900000); n.response.bodyReceivedAt = at(-900000);
  assert.equal(check(e, at(86400000)).allowed, true);
});
test('guard explicit synthetic direct edge is checked independently from same-family', () => {
  const bound = { ...binding, lineageRootReceiptNumber: '20250101000001' };
  const e = evidence(bound);
  assert.equal(assessEvidence(e, bound, 'admission', SYNTHETIC_NOW).allowed, true);
  e.lineage!.edges[0]!.proof.references = [];
  const result = assessEvidence(e, bound, 'admission', SYNTHETIC_NOW);
  assert.equal(result.allowed, false); assert.ok(result.reasons.includes('DIRECT_EDGE_UNPROVEN'));
});
const refusals: [string, (e: AdmissionEvidence) => void, string][] = [
  ['lineage absent', e => { e.lineage = null; }, 'ROOT_UNPROVEN'],
  ['root unsupported', e => { e.lineage!.rootProof.subject = ['00000000000000']; }, 'ROOT_UNPROVEN'],
  ['direct edge missing', e => { e.lineage!.members = [target.receipt, '20260101000002']; }, 'COMPLETENESS_UNPROVEN'],
  ['identity mismatch', e => { e.target.symbol = '999999'; }, 'TARGET_MISMATCH'],
  ['N only', e => { e.artifacts = e.artifacts.slice(0, 1); }, 'FINAL_UNAVAILABLE'],
  ['NOT_REQUESTED', e => { e.artifacts = e.artifacts.filter(a => a.source.kind !== 'list-final'); e.finalQuery = 'not-requested'; }, 'FINAL_NOT_REQUESTED'],
  ['legacy N phase', e => { e.artifacts[0]!.source.request.provenance = 'legacy-collection-contract'; }, 'LEGACY_PHASE_REJECTED'],
  ['missing body', e => { e.artifacts[0]!.source.response.bodyReceivedAt = null; }, 'BODY_TIME_REQUIRED'],
  ['future body', e => { e.artifacts[0]!.source.response.bodyReceivedAt = at(1); }, 'TIME_IN_FUTURE'],
  ['invalid time', e => { e.artifacts[0]!.source.response.bodyReceivedAt = '2026-02-30T00:00:00Z'; }, 'TIME_INVALID'],
  ['timezone ambiguous', e => { e.artifacts[0]!.source.response.bodyReceivedAt = '2026-10-08T00:00:00'; }, 'TIME_INVALID'],
  ['reversed headers', e => { e.artifacts[0]!.source.response.headersObservedAt = at(1); }, 'TIME_REVERSED'],
  ['simulation bypass', e => { e.policyId = 'POLICY_SIMULATION'; }, 'POLICY_BINDING_MISMATCH'],
  ['representation mismatch', e => { e.binding = { ...e.binding, representationFingerprint: 'b'.repeat(64) }; }, 'EVIDENCE_BINDING_MISMATCH'],
  ['transport failure', e => { e.refresh = 'transport-failed'; }, 'REFRESH_TRANSPORT_FAILED'],
  ['malformed refresh', e => { e.refresh = 'malformed'; }, 'REFRESH_MALFORMED'],
  ['contradiction refresh', e => { e.refresh = 'contradiction'; }, 'REFRESH_CONTRADICTION'],
  ['absent refresh', e => { e.refresh = 'target-absent'; }, 'REFRESH_TARGET_ABSENT'],
];
for (const [name, mutate, reason] of refusals) test(`guard refuses ${name}`, () => {
  const e = evidence(); mutate(e); const result = check(e); assert.equal(result.allowed, false); assert.ok(result.reasons.includes(reason), result.reasons.join(','));
});
for (const [name, text, reason] of [
  ['absent', JSON.stringify({ status: '013' }), 'FINAL_ABSENT_IN_THIS_RESPONSE'],
  ['incomplete', page([row()], { page_count: 1, total_count: 2, total_page: 2 }), 'FINAL_INCOMPLETE'],
] as const) test(`guard distinguishes final ${name}`, () => {
  const e = evidence(); const s = source('list-final', text, target, SYNTHETIC_NOW);
  if (name === 'incomplete') s.request.parameters.page_count = '1';
  e.artifacts = [e.artifacts[0]!, { source: s, bytes: Buffer.from(text) }, e.artifacts[2]!];
  assert.ok(check(e).reasons.includes(reason));
});
test('guard re-extracts raw bytes and rejects forged hashes and request identity', () => {
  const e = evidence(); e.artifacts[0]!.source.rawBodySha256 = '0'.repeat(64);
  assert.throws(() => check(e), /SOURCE_HASH_MISMATCH/);
  const other = evidence(); other.artifacts[0]!.source.request.parameters.corp_code = '99999999';
  assert.throws(() => check(other), /SOURCE_CONTEXT_MISMATCH/);
});
test('guard missing or malformed viewer and opposite remarks are never absence of warning', () => {
  const e = evidence(); const text = '<html>unsupported</html>';
  e.artifacts = [...e.artifacts.slice(0, 2), { source: source('viewer-main', text, target, SYNTHETIC_NOW), bytes: Buffer.from(text) }];
  assert.ok(check(e).reasons.includes('VIEWER_UNACCEPTABLE'));
  const opposite = evidence(); const body = page([{ ...row(), rm: '정' }]);
  opposite.artifacts = [{ source: source('list-all', body, target, SYNTHETIC_NOW), bytes: Buffer.from(body) }, ...opposite.artifacts.slice(1)];
  assert.ok(check(opposite).reasons.includes('CONTRADICTION'));
});
test('transport failure permits only bounded existing use, never refreshed expiry', () => {
  const e = evidence(); e.refresh = 'transport-failed';
  assert.equal(check(e, at(86400000), 'use').allowed, true);
  assert.equal(check(e, at(86400001), 'use').allowed, false);
  assert.equal(check(e).allowed, false);
});
test('optional request/header times do not replace required body phase', () => {
  const e = evidence(); for (const a of e.artifacts) { a.source.request.startedAt = null; a.source.response.headersObservedAt = null; }
  assert.equal(check(e).allowed, true);
});
test('pure offline assessment keeps HELD root even with synthetic WITHIN_LIMITS flag', () => {
  const e = evidence(); e.lineage = null;
  const observations = e.artifacts.map(a => extractObservation(a.source, a.bytes));
  const result = assessObservations(Object.assign(e, { verified: true, approved: true, simulation: 'WITHIN_LIMITS' }), observations, binding, 'admission', SYNTHETIC_NOW);
  assert.equal(result.allowed, false); assert.ok(result.unverified.includes('ROOT_UNPROVEN'));
});
test('guard missing/null/throwing provider fails closed with sanitized reasons', async () => {
  assert.throws(() => new AdmissionGuard(undefined as never), AdmissionDenied);
  await assert.rejects(new AdmissionGuard({ async load() { return null; } }).inspect(binding, 'use'), /FILING_ADMISSION_DENIED/);
  await assert.rejects(new AdmissionGuard({ async load() { throw new Error('private'); } }).inspect(binding, 'use'), (e: unknown) =>
    e instanceof AdmissionDenied && e.reasons[0] === 'EVIDENCE_PROVIDER_FAILED' && !e.message.includes('private'));
});
test('guard sessions pin evidence revision across checks, not a caller token', async () => {
  const { guard } = fakeGuard((e, call) => { if (call > 1) e.revision = 'new'; });
  const session = guard.session(); await session.check(binding, 'use');
  await assert.rejects(session.check(binding, 'use'), (e: unknown) => e instanceof AdmissionDenied && e.reasons.includes('EVIDENCE_REVISION_CHANGED'));
});
test('guard sessions reject changed family revision even if internal provider echoes new binding', async () => {
  const { guard } = fakeGuard(); const s = guard.session();
  await s.check({ ...binding, familyRevision: '1' }, 'use');
  await assert.rejects(s.check({ ...binding, familyRevision: '2' }, 'use'),
    (e: unknown) => e instanceof AdmissionDenied && e.reasons.includes('TARGET_REVISION_CHANGED'));
});
test('F3 shared guard interleaved requests retain independent evidence pins', async () => {
  let revision = 'one';
  const { guard } = fakeGuard(e => { e.revision = revision; });
  const a = guard.session(), b = guard.session();
  await a.check(binding, 'use'); revision = 'two'; await b.check(binding, 'use');
  revision = 'one'; await a.check(binding, 'use'); revision = 'two'; await b.check(binding, 'use');
  await assert.rejects(a.check(binding, 'use'), AdmissionDenied);
});
