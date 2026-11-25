import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalSha256 } from '../evaluation/filingDense/canonical.js';
import { DenseEvaluationError } from '../evaluation/filingDense/contracts.js';
import { verifyPrivateHoldoutReviewLedger } from '../evaluation/filingDense/privateHoldoutReviewLedger.js';

const sentinel = 'SYNTHETIC_PRIVATE_SENTINEL';
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const syntheticHash = 'a'.repeat(64);

function syntheticRows(count = 20) {
  return Array.from({ length: count }, (_, i) => {
    const company = { corpCode: '00000000', symbol: '000000' };
    return {
      queryId: 'HOLD-' + String(i + 1).padStart(3, '0'), split: 'holdout', queryText: sentinel + i,
      categories: ['numeric'], company, reportFamily: 'annual', evidenceModality: 'narrative',
      currentEffectiveCorrection: false, review: { status: 'pending', reviewRoundCount: 0 },
      evidenceGroups: [{ evidenceGroupId: 'G1', grade: 2, acceptableChunks: [{
        ...company, provider: 'opendart-fss', receiptNumber: '00000000000000', documentId: 'synthetic',
        chunkId: 'synthetic-' + i, contentHash: syntheticHash, representationFingerprint: syntheticHash,
        parserVersion: 'test', chunkerVersion: 'test', schemaVersion: 'test',
        sectionPath: [sentinel], locator: { ordinal: i },
      }] }],
    };
  });
}

function setup(entries = syntheticRows()) {
  const payload = { datasetId: 'dense-eval-v1', schemaVersion: 'dense-eval-dataset@1',
    split: 'holdout', targetCount: 20, entries };
  const canonicalHash = canonicalSha256(payload);
  const bytes = Buffer.from(JSON.stringify({ payload, canonicalHash }));
  const target = { releaseId: 'synthetic-release', versionId: 'v1', fileSha256: hash(bytes), canonicalHash };
  const targetDigest = canonicalSha256(target);
  const events = entries.flatMap(e => [1, 2].map(round => ({
    eventId: e.queryId + '-' + round, queryId: e.queryId, round, outcome: 'pass', targetDigest,
    reviewerRoleId: 'synthetic-author', reviewedAt: '2000-02-29T00:00:0' + round + 'Z',
  })));
  const ledger = { target: { ...target }, events };
  return { bytes, target, ledger, check: () => verifyPrivateHoldoutReviewLedger(bytes, JSON.stringify(ledger), target) };
}

function denied(check: () => unknown) {
  assert.throws(check, (error: unknown) => {
    assert.ok(error instanceof DenseEvaluationError);
    assert.equal(error.code, 'PRIVATE_HOLDOUT_REVIEW_LEDGER_INVALID');
    assert.equal(error.message, error.code);
    assert.equal(error.stack, error.name + ': ' + error.code);
    assert.equal(error.cause, undefined);
    assert.ok(!JSON.stringify(error).includes(sentinel));
    return true;
  });
}

test('one role may complete both passes on each item; return only target and aggregate counts', () => {
  const f = setup();
  f.ledger.events.reverse();
  const before = Buffer.from(f.bytes);
  const result = f.check();
  assert.deepEqual(result, { ...f.target, queryCount: 20, passedEventCount: 40 });
  assert.ok(!JSON.stringify(result).includes(sentinel));
  assert.deepEqual(f.bytes, before);
});

test('missing one pass, unknown item, duplicate item/round or reused event ID cannot fill the ledger', () => {
  const missing = setup();
  missing.ledger.events.pop();
  denied(missing.check);
  for (const patch of [{ queryId: 'HOLD-999' }, { queryId: 'HOLD-002' }, { round: 2 },
    { eventId: 'HOLD-020-2' }]) {
    const f = setup();
    Object.assign(f.ledger.events[0]!, patch);
    denied(f.check);
  }
  const rows = syntheticRows();
  rows[1]!.queryId = rows[0]!.queryId;
  denied(setup(rows).check);
});

for (const field of ['releaseId', 'versionId', 'fileSha256', 'canonicalHash'] as const) {
  test('reject a mismatched ' + field + ' on the ledger, an individual event or the external target', () => {
    const f = setup();
    const other = { ...f.target, [field]: field.endsWith('Id') ? 'other' : syntheticHash };
    f.ledger.target = other;
    denied(f.check);
    f.ledger.target = { ...f.target };
    denied(() => verifyPrivateHoldoutReviewLedger(f.bytes, JSON.stringify(f.ledger), other));
    f.ledger.events[39]!.targetDigest = canonicalSha256(other);
    denied(f.check);
  });
}

test('rebuilt envelope and updated ledger header do not rebind old review events', () => {
  const original = setup();
  for (const change of ['question', 'pin', 'grade', 'category']) {
    const rows = syntheticRows(), row = rows[0]!;
    if (change === 'question') row.queryText += ' modified';
    if (change === 'pin') row.evidenceGroups[0]!.acceptableChunks[0]!.locator.ordinal++;
    if (change === 'grade') row.evidenceGroups[0]!.grade = 1;
    if (change === 'category') row.categories = ['period'];
    const changed = setup(rows);
    denied(() => verifyPrivateHoldoutReviewLedger(changed.bytes, JSON.stringify(original.ledger), original.target));
    changed.ledger.events = original.ledger.events;
    denied(changed.check);
  }
});

test('byte hash detects reformatting even when payload hash is unchanged', () => {
  const f = setup();
  denied(() => verifyPrivateHoldoutReviewLedger(Buffer.concat([f.bytes, Buffer.from('\n')]), JSON.stringify(f.ledger), f.target));
});

test('reject non-pass outcomes, invalid rounds, roles, event IDs and timestamps', () => {
  for (const patch of [{ outcome: 'failed' }, { outcome: 'pending' }, { round: 0 }, { round: 3 },
    { round: '1' }, { eventId: '' }, { reviewerRoleId: 'A B' }, { reviewerRoleId: '/' + sentinel },
    { reviewedAt: '2001-02-29T00:00:01Z' }, { reviewedAt: '2000-02-29' },
    { reviewedAt: '2000-02-29T00:00:01+00:00' },
    { reviewedAt: '2000-02-29T00:00:02Z' }, { reviewedAt: '2000-02-29T00:00:03Z' }]) {
    const f = setup();
    Object.assign(f.ledger.events[0]!, patch);
    denied(f.check);
  }
});

test('reject non-20 datasets and non-pending or embellished pending review metadata', () => {
  for (const n of [0, 19, 21]) denied(setup(syntheticRows(n)).check);
  for (const metadata of [{ status: 'reviewed', reviewRoundCount: 1 },
    { status: 'sealed', reviewRoundCount: 2, reviewedAt: '2000-02-29T00:00:01Z', reviewerRoleId: 'synthetic' },
    { reviewRoundCount: 1 }, { reviewedAt: null }, { reviewerRoleId: 'synthetic' }]) {
    const rows = syntheticRows();
    Object.assign(rows[0]!.review, metadata);
    denied(setup(rows).check);
  }
});

test('no free-form fields on ledger, binding or record, and no path-shaped identifiers', () => {
  for (const location of ['ledger', 'target', 'event']) {
    const f = setup();
    Object.assign(location === 'ledger' ? f.ledger : location === 'target' ? f.ledger.target : f.ledger.events[0]!,
      { notes: sentinel });
    denied(f.check);
  }
  const f = setup();
  f.target.releaseId = '/private/' + sentinel;
  f.ledger.target = { ...f.target };
  for (const event of f.ledger.events) event.targetDigest = canonicalSha256(f.target);
  denied(f.check);
});

test('malformed ledger, malformed UTF-8 and parser failures never disclose input details', () => {
  const f = setup();
  denied(() => verifyPrivateHoldoutReviewLedger(f.bytes, sentinel, f.target));
  for (const bytes of [Buffer.from([0xff]), Buffer.from(sentinel), Buffer.from(JSON.stringify({ unexpected: sentinel }))]) {
    denied(() => verifyPrivateHoldoutReviewLedger(bytes, JSON.stringify(f.ledger), { ...f.target, fileSha256: hash(bytes) }));
  }
});
