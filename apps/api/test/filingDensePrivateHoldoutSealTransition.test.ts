import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalSha256 } from '../evaluation/filingDense/canonical.js';
import { DenseEvaluationError } from '../evaluation/filingDense/contracts.js';
import { verifyPrivateHoldoutSealTransition as verify } from '../evaluation/filingDense/privateHoldoutSealTransition.js';

const sentinel = 'SYNTHETIC_PRIVATE_SEAL_SENTINEL';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function pack(payload: unknown) {
  const canonicalHash = canonicalSha256(payload);
  const bytes = Buffer.from(JSON.stringify({ payload, canonicalHash }));
  return { bytes, digests: { canonicalHash, fileSha256: sha(bytes) } };
}

function fixture() {
  const entries = Array.from({ length: 20 }, (_, i) => {
    const company = { corpCode: '00000000', symbol: '000000' };
    return { queryId: 'HOLD-' + String(i + 1).padStart(3, '0'), split: 'holdout',
      queryText: sentinel + i, notes: 'synthetic notes', categories: ['numeric'], company,
      reportFamily: 'annual', evidenceModality: 'narrative', currentEffectiveCorrection: false,
      evidenceGroups: [{ evidenceGroupId: 'G1', grade: 2, acceptableChunks: [{ ...company,
        provider: 'opendart-fss', receiptNumber: '00000000000000', documentId: 'synthetic-document',
        chunkId: 'synthetic-chunk-' + i, contentHash: 'a'.repeat(64), representationFingerprint: 'b'.repeat(64),
        parserVersion: 'synthetic', chunkerVersion: 'synthetic', schemaVersion: 'synthetic',
        sectionPath: [sentinel], locator: { ordinal: i } }] }],
      review: { status: 'pending', reviewRoundCount: 0 } };
  });
  const payload = { split: 'holdout', datasetId: 'dense-eval-v1', schemaVersion: 'dense-eval-dataset@1',
    targetCount: 20, entries };
  const pending = pack(payload);
  const target = { releaseId: 'synthetic-release', versionId: 'synthetic-v1', ...pending.digests };
  const targetDigest = canonicalSha256(target);
  const events = entries.flatMap(({ queryId }, i) => [1, 2].map(round => ({
    queryId, round, eventId: queryId + '-' + round, outcome: 'pass', targetDigest,
    reviewedAt: '2000-01-01T00:0' + round + ':' + String(i).padStart(2, '0') + 'Z',
    reviewerRoleId: 'synthetic-author-' + i,
  })));
  const ledger = { target, events };
  const sealed = { ...payload, entries: structuredClone(entries).map((entry, i) => ({
    ...entry, review: { status: 'sealed', reviewRoundCount: 2,
      reviewedAt: events[2 * i + 1]!.reviewedAt, reviewerRoleId: events[2 * i + 1]!.reviewerRoleId },
  })) };
  const check = () => {
    const candidate = pack(sealed);
    return verify(pending.bytes, candidate.bytes, JSON.stringify(ledger),
      { pending: target, sealedCandidate: candidate.digests });
  };
  return { pending, payload, target, ledger, sealed, check };
}

function denied(run: () => unknown) {
  assert.throws(run, (err: unknown) => {
    assert.ok(err instanceof DenseEvaluationError);
    assert.equal(err.code, 'PRIVATE_HOLDOUT_SEAL_TRANSITION_INVALID');
    assert.equal(err.message, err.code);
    assert.equal(err.stack, err.name + ': ' + err.code);
    assert.equal(err.cause, undefined);
    assert.ok(!JSON.stringify(err).includes(sentinel));
    return true;
  });
}

test('accept per-item round two, same role across rounds, reversed event order; no mutation or disclosure', () => {
  const f = fixture(), c = pack(f.sealed);
  f.ledger.events.reverse();
  const json = JSON.stringify(f.ledger), expected = { pending: f.target, sealedCandidate: c.digests };
  const before = [Buffer.from(f.pending.bytes), Buffer.from(c.bytes)];
  const summary = verify(f.pending.bytes, c.bytes, json, expected);
  assert.deepEqual(summary, { releaseId: f.target.releaseId, versionId: f.target.versionId,
    pendingFileSha256: f.target.fileSha256, pendingCanonicalHash: f.target.canonicalHash,
    sealedFileSha256: c.digests.fileSha256, sealedCanonicalHash: c.digests.canonicalHash,
    queryCount: 20, passedEventCount: 40 });
  assert.ok(!JSON.stringify(summary).includes(sentinel));
  assert.notEqual(summary.pendingCanonicalHash, summary.sealedCanonicalHash);
  assert.deepEqual([f.pending.bytes, c.bytes], before);
  assert.equal(json, JSON.stringify(f.ledger));
});

type Entry = ReturnType<typeof fixture>['sealed']['entries'][number];
const mutations: Record<string, (entry: Entry) => void> = {
  question: e => { e.queryText += ' changed'; },
  pin: e => { e.evidenceGroups[0]!.acceptableChunks[0]!.contentHash = 'c'.repeat(64); },
  locator: e => { e.evidenceGroups[0]!.acceptableChunks[0]!.locator.ordinal++; },
  grade: e => { e.evidenceGroups[0]!.grade = 1; },
  category: e => { e.categories = ['period']; },
  notes: e => { e.notes += '!'; },
  id: e => { e.queryId = 'HOLD-999'; },
  time: e => { e.review.reviewedAt = '2000-01-01T00:02:01Z'; },
  role: e => { e.review.reviewerRoleId = 'synthetic-author-1'; },
  count: e => { e.review.reviewRoundCount = 3; },
};
for (const [field, mutate] of Object.entries(mutations)) {
  test('reject changed ' + field + ' even with matching candidate file and canonical hashes', () => {
    const f = fixture();
    mutate(f.sealed.entries[0]!);
    denied(f.check);
  });
}

test('reject additions, omissions, reordered entries and partially or wholly pending candidates', () => {
  for (const change of ['add', 'drop', 'reverse', 'mixed', 'pending']) {
    const f = fixture(), rows = f.sealed.entries;
    if (change === 'add') rows.push({ ...rows[0]!, queryId: 'HOLD-021' });
    if (change === 'drop') rows.pop();
    if (change === 'reverse') rows.reverse();
    if (change === 'mixed' || change === 'pending') {
      for (const row of change === 'mixed' ? rows.slice(0, 1) : rows) {
        Object.assign(row, { review: { status: 'pending', reviewRoundCount: 0 } });
      }
    }
    denied(f.check);
  }
});

test('reject stale ledger, swapped bindings, missing expectations and incomplete review events', () => {
  const f = fixture(), c = pack(f.sealed), json = JSON.stringify(f.ledger);
  const expected = { pending: f.target, sealedCandidate: c.digests };
  const run = (e: typeof expected) => verify(f.pending.bytes, c.bytes, json, e);
  denied(() => run({ ...expected, pending: { ...f.target, versionId: 'synthetic-v2' } }));
  denied(() => run({ pending: { ...f.target, ...c.digests }, sealedCandidate: f.target }));
  for (const group of ['pending', 'sealedCandidate'] as const) {
    for (const key of Object.keys(expected[group])) {
      const incomplete = structuredClone(expected);
      Reflect.deleteProperty(incomplete[group], key);
      denied(() => run(incomplete));
    }
    for (const key of ['canonicalHash', 'fileSha256'] as const) {
      const wrong = structuredClone(expected);
      wrong[group][key] = '0'.repeat(64);
      denied(() => run(wrong));
    }
  }
  f.ledger.events.pop();
  denied(f.check);
});

test('both inputs reject malformed JSON, malformed UTF-8, empty and over-limit snapshots', () => {
  const f = fixture(), c = pack(f.sealed), json = JSON.stringify(f.ledger);
  for (const group of ['pending', 'sealedCandidate'] as const) {
    const original = group === 'pending' ? f.pending : c;
    const malformed = Buffer.from(original.bytes);
    malformed[malformed.indexOf(sentinel)] = 0xff;
    for (const bytes of [malformed, Buffer.from(sentinel), Buffer.alloc(0), Buffer.alloc(16 * 1024 * 1024 + 1)]) {
      const expected = { pending: { ...f.target }, sealedCandidate: { ...c.digests } };
      expected[group].fileSha256 = sha(bytes);
      denied(() => verify(group === 'pending' ? bytes : f.pending.bytes,
        group === 'sealedCandidate' ? bytes : c.bytes, json, expected));
    }
  }
  for (const bad of [sentinel, json.padEnd(65537)]) {
    denied(() => verify(f.pending.bytes, c.bytes, bad, { pending: f.target, sealedCandidate: c.digests }));
  }
});

test('reject wire-only targetCount change even when parser normalization preserves the payload hash', () => {
  const f = fixture(), c = pack(f.sealed);
  const bytes = Buffer.from(JSON.stringify({ payload: { ...f.sealed, targetCount: '20' },
    canonicalHash: c.digests.canonicalHash }));
  denied(() => verify(f.pending.bytes, bytes, JSON.stringify(f.ledger),
    { pending: f.target, sealedCandidate: { ...c.digests, fileSha256: sha(bytes) } }));
});
