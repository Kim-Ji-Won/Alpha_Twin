import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { canonicalJson, canonicalSha256 } from '../evaluation/filingDense/canonical.js';
import { DenseEvaluationError } from '../evaluation/filingDense/contracts.js';
import { verifyPrivateHoldoutTrustedSealApproval as verify } from '../evaluation/filingDense/privateHoldoutTrustedSealApproval.js';

const sentinel = 'SYNTHETIC_PRIVATE_SIGNATURE_SENTINEL';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function envelope(payload: unknown) {
  const canonicalHash = canonicalSha256(payload);
  const bytes = Buffer.from(JSON.stringify({ payload, canonicalHash }));
  return { bytes, canonicalHash };
}

function fixture() {
  const company = { corpCode: '00000000', symbol: '000000' };
  const entries = Array.from({ length: 20 }, (_, i) => ({
    queryId: 'HOLD-' + String(i + 1).padStart(3, '0'), split: 'holdout', company,
    queryText: sentinel + i, categories: ['numeric'], reportFamily: 'annual', evidenceModality: 'narrative',
    currentEffectiveCorrection: false, review: { status: 'pending', reviewRoundCount: 0 },
    evidenceGroups: [{ evidenceGroupId: 'G1', grade: 2, acceptableChunks: [{ ...company,
      provider: 'opendart-fss', receiptNumber: '00000000000000', documentId: 'synthetic', chunkId: 'test-' + i,
      contentHash: 'a'.repeat(64), representationFingerprint: 'b'.repeat(64), parserVersion: 'test',
      chunkerVersion: 'test', schemaVersion: 'test', sectionPath: [sentinel], locator: { ordinal: i },
    }] }],
  }));
  const payload = { entries, datasetId: 'dense-eval-v1', schemaVersion: 'dense-eval-dataset@1',
    split: 'holdout', targetCount: 20 };
  const pending = envelope(payload);
  const target = { releaseId: 'test-release', versionId: 'test-pending', fileSha256: hash(pending.bytes),
    canonicalHash: pending.canonicalHash };
  const digest = canonicalSha256(target);
  const events = entries.flatMap(({ queryId }) => [1, 2].map(round => ({
    queryId, eventId: queryId + '-' + round, round, targetDigest: digest, outcome: 'pass',
    reviewedAt: '2000-01-01T00:00:0' + round + 'Z', reviewerRoleId: 'synthetic-author',
  })));
  const ledger = { target, events }, ledgerBytes = Buffer.from(JSON.stringify(ledger));
  const sealedPayload = { ...payload, entries: entries.map(e => ({ ...e, review: {
    status: 'sealed', reviewRoundCount: 2, reviewedAt: events[1]!.reviewedAt, reviewerRoleId: 'synthetic-author',
  } })) };
  const sealed = envelope(sealedPayload);
  const ids = { approvalId: 'synthetic-approval', releaseId: target.releaseId,
    pendingVersionId: target.versionId, sealedVersionId: 'test-candidate' };
  const manifest = { schema: 'private-holdout-seal-approval@1', purpose: 'seal-transition', ...ids,
    pendingFileSha256: target.fileSha256, pendingCanonicalHash: target.canonicalHash,
    ledgerFileSha256: hash(ledgerBytes), sealedFileSha256: hash(sealed.bytes), sealedCanonicalHash: sealed.canonicalHash };
  const keys = generateKeyPairSync('ed25519');
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  const trusted = { ...ids, manifestSha256: hash(manifestBytes),
    publicKeySpkiDer: keys.publicKey.export({ format: 'der', type: 'spki' }) };
  const input = { manifestBytes, signatureBytes: sign(null, manifestBytes, keys.privateKey),
    pendingBytes: pending.bytes, sealedCandidateBytes: sealed.bytes, ledgerBytes };
  // Test signer only. Bind even deliberately invalid wire encodings to isolate parser failures.
  function authorize(bytes = Buffer.from(canonicalJson(manifest))) {
    input.manifestBytes = bytes;
    input.signatureBytes = sign(null, bytes, keys.privateKey);
    trusted.manifestSha256 = hash(bytes);
  }
  return { input, trusted, manifest, ledger, sealedPayload, authorize, check: () => verify(input, trusted) };
}

function denied(run: () => unknown) {
  assert.throws(run, (err: unknown) => {
    assert.ok(err instanceof DenseEvaluationError);
    assert.equal(err.code, 'PRIVATE_HOLDOUT_TRUSTED_SEAL_APPROVAL_INVALID');
    assert.equal(err.message, err.code);
    assert.equal(err.stack, err.name + ': ' + err.code);
    assert.equal(err.cause, undefined);
    assert.ok(!JSON.stringify(err).includes(sentinel));
    return true;
  });
}

test('accept signed synthetic transition; rechecking is allowed, inputs unchanged, summary only', () => {
  const f = fixture();
  const before = Object.values(f.input).map(bytes => Buffer.from(bytes));
  const keyBefore = Buffer.from(f.trusted.publicKeySpkiDer);
  const summary = { approvalId: f.trusted.approvalId, manifestSha256: f.trusted.manifestSha256,
    queryCount: 20, passedEventCount: 40 };
  assert.deepEqual(f.check(), summary);
  assert.deepEqual(f.check(), summary);
  assert.deepEqual(Object.values(f.input), before);
  assert.deepEqual(f.trusted.publicKeySpkiDer, keyBefore);
  assert.ok(!JSON.stringify(summary).includes(sentinel));
});

test('only the independently supplied canonical Ed25519 SPKI and exact signature verify', () => {
  const f = fixture(), other = generateKeyPairSync('ed25519');
  for (const key of [other.publicKey, generateKeyPairSync('x25519').publicKey]) {
    denied(() => verify(f.input, { ...f.trusted, publicKeySpkiDer: key.export({ format: 'der', type: 'spki' }) }));
  }
  denied(() => verify(f.input, { ...f.trusted, publicKeySpkiDer: Buffer.concat([f.trusted.publicKeySpkiDer, Buffer.of(0)]) }));
  const corrupt = Buffer.from(f.input.signatureBytes);
  corrupt[0] = corrupt[0]! ^ 1;
  for (const signatureBytes of [corrupt, sign(null, f.input.manifestBytes, other.privateKey), Buffer.alloc(64),
    Buffer.alloc(0), Buffer.alloc(63), Buffer.alloc(65)]) {
    denied(() => verify({ ...f.input, signatureBytes }, f.trusted));
  }
});

test('signed manifest must have exactly the fixed schema, purpose, typed identifiers and digests', () => {
  for (const patch of [{ purpose: 'final-benchmark' }, { schema: 'private-holdout-seal-approval@2' },
    { publicKey: sentinel }, { extra: true }, { pendingCanonicalHash: null }, { ledgerFileSha256: 'A'.repeat(64) },
    { approvalId: 1 }, { releaseId: '/synthetic' }, { sealedVersionId: 'test-pending' }]) {
    const f = fixture();
    Object.assign(f.manifest, patch);
    if ('sealedVersionId' in patch) f.trusted.sealedVersionId = f.manifest.sealedVersionId;
    f.authorize();
    denied(f.check);
  }
  const f = fixture();
  for (const key of Object.keys(f.manifest)) {
    const missing = { ...f.manifest };
    Reflect.deleteProperty(missing, key);
    f.authorize(Buffer.from(canonicalJson(missing)));
    denied(f.check);
  }
});

test('old approval or missing/mismatched external pins cannot be supplied by the signed manifest', () => {
  const f = fixture();
  for (const k of ['approvalId', 'releaseId', 'pendingVersionId', 'sealedVersionId', 'manifestSha256'] as const) {
    for (const value of ['different-current-target', '', 7]) {
      denied(() => verify(f.input, Object.assign({ ...f.trusted }, { [k]: value })));
    }
  }
  for (const k of Object.keys(f.trusted)) {
    const missing = { ...f.trusted };
    Reflect.deleteProperty(missing, k);
    denied(() => verify(f.input, missing));
  }
});

test('signed exact digest does not excuse malformed or noncanonical manifest bytes', () => {
  const f = fixture(), json = f.input.manifestBytes.toString();
  for (const bytes of [Buffer.from(sentinel), Buffer.of(0xff), Buffer.from(json + '\n'),
    Buffer.from(JSON.stringify(f.manifest)), Buffer.from('\uFEFF' + json),
    Buffer.from('{"purpose":"seal-transition",' + json.slice(1))]) {
    f.authorize(bytes);
    denied(f.check);
  }
});

test('raw Dataset and ledger bytes are bound independently, including round one alone', () => {
  const f = fixture();
  for (const k of ['pendingBytes', 'sealedCandidateBytes', 'ledgerBytes'] as const) {
    denied(() => verify({ ...f.input, [k]: Buffer.concat([f.input[k], Buffer.from('\n')]) }, f.trusted));
  }
  f.ledger.events[0]!.reviewerRoleId = 'other-round-one';
  f.input.ledgerBytes = Buffer.from(JSON.stringify(f.ledger));
  denied(f.check);
  // Only reauthorizing the changed ledger can make this otherwise valid transition pass.
  f.manifest.ledgerFileSha256 = hash(f.input.ledgerBytes);
  f.authorize();
  assert.equal(f.check().passedEventCount, 40);
});

test('updating internal hashes cannot replace either the old signature or the external digest', () => {
  const f = fixture(), oldSig = f.input.signatureBytes, oldHash = f.trusted.manifestSha256;
  f.sealedPayload.entries[0]!.queryText += ' changed';
  const candidate = envelope(f.sealedPayload);
  f.input.sealedCandidateBytes = candidate.bytes;
  Object.assign(f.manifest, { sealedFileSha256: hash(candidate.bytes), sealedCanonicalHash: candidate.canonicalHash });
  f.authorize();
  denied(() => verify({ ...f.input, signatureBytes: oldSig }, f.trusted));
  denied(() => verify(f.input, { ...f.trusted, manifestSha256: oldHash }));
  denied(f.check);
});

test('a matching signature cannot override invalid ledger bytes/events or round two metadata', () => {
  for (const kind of ['utf8', 'json', 'missing-pass', 'wrong-role']) {
    const f = fixture();
    if (kind === 'wrong-role') {
      f.sealedPayload.entries[0]!.review.reviewerRoleId = 'synthetic-other';
      const candidate = envelope(f.sealedPayload);
      f.input.sealedCandidateBytes = candidate.bytes;
      Object.assign(f.manifest, { sealedFileSha256: hash(candidate.bytes), sealedCanonicalHash: candidate.canonicalHash });
    } else {
      f.ledger.events.pop();
      f.input.ledgerBytes = kind === 'utf8' ? Buffer.of(0xff)
        : Buffer.from(kind === 'json' ? sentinel : JSON.stringify(f.ledger));
      f.manifest.ledgerFileSha256 = hash(f.input.ledgerBytes);
    }
    f.authorize();
    denied(f.check);
  }
});

test('empty and oversized buffers fail closed for every bounded input', () => {
  const f = fixture();
  for (const [k, max] of [['manifestBytes', 4096], ['ledgerBytes', 65536],
    ['pendingBytes', 16 * 1024 * 1024], ['sealedCandidateBytes', 16 * 1024 * 1024]] as const) {
    for (const size of [0, max + 1]) denied(() => verify({ ...f.input, [k]: Buffer.alloc(size) }, f.trusted));
  }
  for (const size of [0, 257]) denied(() => verify(f.input, { ...f.trusted, publicKeySpkiDer: Buffer.alloc(size) }));
});
