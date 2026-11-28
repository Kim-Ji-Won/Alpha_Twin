import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { canonicalJson, canonicalSha256 } from '../evaluation/filingDense/canonical.js';
import { DENSE_EVAL_CATEGORIES, DenseEvaluationError, type DenseEvalEntry,
  type DenseEvalSplit } from '../evaluation/filingDense/contracts.js';
import { verifyPrivateHoldoutRelease, type PrivateReleaseApproval } from '../evaluation/filingDense/privateHoldoutAccess.js';
import { verifyPrivateHoldoutReleaseCandidate as verify } from '../evaluation/filingDense/privateHoldoutReleaseCandidate.js';

const sentinel = 'SYNTHETIC_I1A_PRIVATE_SENTINEL';
const ids = { releaseId: 'synthetic-release', approvalId: 'synthetic-seal',
  pendingVersionId: 'synthetic-pending', sealedVersionId: 'synthetic-sealed' };
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const time = (round: number) => '2000-01-01T00:00:0' + round + 'Z';
const role = 'synthetic-review';
function rows(split: DenseEvalSplit, count: number): DenseEvalEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const suffix = String(1 + i % 2), company = { corpCode: suffix.padStart(8, '0'), symbol: suffix.padStart(6, '0') };
    return { split, queryId: (split === 'dev' ? 'DEV-' : 'HOLD-') + String(i + 1).padStart(3, '0'),
      company, queryText: sentinel + i, categories: DENSE_EVAL_CATEGORIES, reportFamily: 'annual',
      evidenceModality: 'narrative', currentEffectiveCorrection: false,
      evidenceGroups: [{ evidenceGroupId: 'G1', grade: 2, acceptableChunks: [{ ...company,
        provider: 'opendart-fss', receiptNumber: '00000000000000', documentId: 'synthetic', chunkId: 'sample-' + i,
        contentHash: 'a'.repeat(64), representationFingerprint: 'b'.repeat(64), parserVersion: 'test',
        chunkerVersion: 'test', schemaVersion: 'test', sectionPath: [sentinel], locator: { ordinal: i },
      }] }],
      review: split === 'holdout' ? { status: 'pending', reviewRoundCount: 0 }
        : { status: 'reviewed', reviewRoundCount: 1, reviewedAt: time(1), reviewerRoleId: role } };
  });
}

function pack(split: DenseEvalSplit, entries: DenseEvalEntry[]) {
  const payload = { datasetId: 'dense-eval-v1', schemaVersion: 'dense-eval-dataset@1',
    targetCount: split === 'dev' ? 40 : 20, split, entries };
  const canonicalHash = canonicalSha256(payload), bytes = Buffer.from(JSON.stringify({ payload, canonicalHash }));
  return { bytes, digest: { canonicalHash, fileSha256: sha(bytes) } };
}

function fixture() {
  const dev = pack('dev', rows('dev', 40)), items = rows('holdout', 20), pending = pack('holdout', items);
  const target = { releaseId: ids.releaseId, versionId: ids.pendingVersionId, ...pending.digest };
  const targetDigest = canonicalSha256(target);
  const events = items.flatMap(({ queryId }) => [1, 2].map(round => ({ queryId, round,
    eventId: queryId + '-' + round, targetDigest, outcome: 'pass', reviewedAt: time(round), reviewerRoleId: role })));
  const ledger = { target, events }, ledgerBytes = Buffer.from(JSON.stringify(ledger));
  const sealedRows = items.map(e => ({ ...e, review: { status: 'sealed' as const,
    reviewRoundCount: 2, reviewedAt: time(2), reviewerRoleId: role } }));
  const sealed = pack('holdout', sealedRows);
  const manifest = { ...ids, schema: 'private-holdout-seal-approval@1', purpose: 'seal-transition',
    pendingFileSha256: pending.digest.fileSha256, pendingCanonicalHash: pending.digest.canonicalHash,
    ledgerFileSha256: sha(ledgerBytes), sealedFileSha256: sealed.digest.fileSha256,
    sealedCanonicalHash: sealed.digest.canonicalHash };
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  function authorize(m: typeof manifest) {
    const manifestBytes = Buffer.from(canonicalJson(m));
    return { manifestBytes, signatureBytes: sign(null, manifestBytes, privateKey) };
  }
  const input = { ...authorize(manifest), pendingBytes: pending.bytes, ledgerBytes, sealedCandidateBytes: sealed.bytes };
  const trusted = { ...ids, manifestSha256: sha(input.manifestBytes),
    publicKeySpkiDer: publicKey.export({ type: 'spki', format: 'der' }) };
  return { input, trusted, dev, sealed, manifest, ledger, sealedRows, authorize,
    check: () => verify(input, trusted, dev.bytes, dev.digest) };
}

function denied(run: () => unknown) {
  assert.throws(run, (err: unknown) => {
    assert.ok(err instanceof DenseEvaluationError);
    assert.equal(err.code, 'PRIVATE_HOLDOUT_RELEASE_CANDIDATE_INVALID');
    assert.equal(err.message, err.code);
    assert.equal(err.stack, err.name + ': ' + err.code);
    assert.equal(err.cause, undefined);
    assert.ok(!JSON.stringify(err).includes(sentinel));
    return true;
  });
}

test('signed candidate and independently bound Dev yield aggregates, not access rights', () => {
  const f = fixture(), bytes = [...Object.values(f.input), f.dev.bytes, f.trusted.publicKeySpkiDer];
  const before = bytes.map(b => Buffer.from(b)), summary = f.check();
  assert.deepEqual(summary, { releaseId: ids.releaseId, sealedVersionId: ids.sealedVersionId,
    approvalId: ids.approvalId, manifestSha256: f.trusted.manifestSha256,
    devFileSha256: f.dev.digest.fileSha256, devCanonicalHash: f.dev.digest.canonicalHash,
    holdoutFileSha256: f.sealed.digest.fileSha256, holdoutCanonicalHash: f.sealed.digest.canonicalHash,
    devCount: 40, holdoutCount: 20, passedEventCount: 40,
    coverageWarnings: ['CORRECTION_TARGET_NOT_MET', 'REPORT_FAMILY_TARGET_NOT_MET', 'MODALITY_TARGET_NOT_MET'] });
  assert.ok(!JSON.stringify(summary).includes(sentinel));
  assert.deepEqual(bytes, before);
});

test('verification and parsing consume one owned sealed snapshot', () => {
  const f = fixture(), expected = f.check();
  let reads = 0;
  const input = { ...f.input, get sealedCandidateBytes() {
    assert.equal(++reads, 1);
    return f.input.sealedCandidateBytes;
  }, get ledgerBytes() {
    f.input.sealedCandidateBytes.fill(0);
    return f.input.ledgerBytes;
  } };
  assert.deepEqual(verify(input, f.trusted, f.dev.bytes, f.dev.digest), expected);
  assert.equal(reads, 1);
});

test('tampered manifest, signature, external context and round-one-only edit fail closed', () => {
  const f = fixture();
  for (const k of ['manifestBytes', 'signatureBytes'] as const) {
    const bytes = Buffer.from(f.input[k]);
    bytes[0] = bytes[0]! ^ 1;
    denied(() => verify({ ...f.input, [k]: bytes }, f.trusted, f.dev.bytes, f.dev.digest));
  }
  denied(() => verify(f.input, { ...f.trusted, sealedVersionId: 'other' }, f.dev.bytes, f.dev.digest));
  f.ledger.events[0]!.reviewerRoleId = 'other-round-one';
  f.input.ledgerBytes = Buffer.from(JSON.stringify(f.ledger));
  denied(f.check);
});

test('rehashing and signing an edited candidate cannot change reviewed content', () => {
  const f = fixture(), altered = pack('holdout', f.sealedRows.map(e => ({ ...e, queryText: sentinel + ' edited' })));
  const signed = f.authorize({ ...f.manifest, sealedFileSha256: altered.digest.fileSha256,
    sealedCanonicalHash: altered.digest.canonicalHash });
  denied(() => verify({ ...f.input, ...signed, sealedCandidateBytes: altered.bytes },
    { ...f.trusted, manifestSha256: sha(signed.manifestBytes) }, f.dev.bytes, f.dev.digest));
});

test('Dev requires independent wire and canonical digests; preserves parser normalization', () => {
  const f = fixture();
  for (const k of ['fileSha256', 'canonicalHash'] as const)
    denied(() => verify(f.input, f.trusted, f.dev.bytes, { ...f.dev.digest, [k]: '0'.repeat(64) }));
  const raw = JSON.parse(f.dev.bytes.toString());
  raw.payload.targetCount = '40';
  const bytes = Buffer.from(JSON.stringify(raw));
  denied(() => verify(f.input, f.trusted, bytes, f.dev.digest));
  assert.equal(verify(f.input, f.trusted, bytes, { ...f.dev.digest, fileSha256: sha(bytes) }).devCount, 40);
});

test('Dev count, pending review and combined coverage hard errors block signed candidates', () => {
  const f = fixture(), dev = rows('dev', 40);
  // Forty Dev rows from one company plus half the Holdout exceed the combined 60% limit.
  const skew = dev.map((e, i) => ({ ...dev[0]!, queryId: e.queryId, queryText: sentinel + i }));
  for (const entries of [dev.slice(1), [...dev.slice(1), { ...dev[0]!,
    review: { status: 'pending' as const, reviewRoundCount: 0 } }], skew]) {
    const d = pack('dev', entries);
    denied(() => verify(f.input, f.trusted, d.bytes, d.digest));
  }
});

test('wrong split and independently file-pinned invalid JSON or UTF-8 are sanitized', () => {
  const f = fixture();
  denied(() => verify(f.input, f.trusted, f.sealed.bytes, f.sealed.digest));
  for (const bytes of [Buffer.from(sentinel), Buffer.from(f.dev.bytes)]) {
    if (bytes.length === f.dev.bytes.length) bytes[bytes.indexOf(sentinel)] = 0xff;
    denied(() => verify(f.input, f.trusted, bytes, { ...f.dev.digest, fileSha256: sha(bytes) }));
  }
});

test('missing, empty and oversized inputs are rejected at the boundary', () => {
  const f = fixture(), max = 16 * 1024 * 1024;
  for (const [k, limit] of [['sealedCandidateBytes', max], ['pendingBytes', max], ['manifestBytes', 4096],
    ['ledgerBytes', 65536], ['signatureBytes', 64]] as const) {
    for (const value of [undefined, Buffer.alloc(0), Buffer.alloc(limit + 1)]) {
      denied(() => verify(Object.assign({}, f.input, { [k]: value }), f.trusted, f.dev.bytes, f.dev.digest));
    }
  }
  denied(() => verify({ ...f.input, signatureBytes: Buffer.alloc(63) }, f.trusted, f.dev.bytes, f.dev.digest));
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(max + 1)]) denied(() => verify(f.input, f.trusted, bytes, f.dev.digest));
  for (const key of [Buffer.alloc(0), Buffer.alloc(257)]) {
    denied(() => verify(f.input, { ...f.trusted, publicKeySpkiDer: key }, f.dev.bytes, f.dev.digest));
  }
});

test('disk guard independently requires final authorization and verifies current private bytes', async () => {
  const f = fixture(), temp = await mkdtemp(join(await realpath(tmpdir()), 'synthetic-i1a-'));
  try {
    const repositoryRoot = join(temp, 'repo'), privateRoot = join(temp, 'private'), releaseId = ids.releaseId;
    const approval: PrivateReleaseApproval = { releaseId, privateRoot, finalEvaluationAuthorized: true,
      dev: f.dev.digest, holdout: f.sealed.digest };
    const request = { privateRoot, repositoryRoot, releaseId };
    assert.equal(f.check().passedEventCount, 40);
    await mkdir(join(repositoryRoot, '.git'), { recursive: true });
    for (const [split, data] of [['dev', f.dev], ['holdout', f.sealed]] as const) {
      const dir = join(privateRoot, releaseId, split);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'dataset.json'), data.bytes);
    }
    const guard = (a: PrivateReleaseApproval) => verifyPrivateHoldoutRelease(request, a);
    const refusal = { code: 'PRIVATE_HOLDOUT_ACCESS_DENIED' };
    assert.equal((await guard(approval)).holdoutCanonicalHash, f.sealed.digest.canonicalHash);
    await assert.rejects(guard({ ...approval, finalEvaluationAuthorized: false }), refusal);
    await assert.rejects(guard({ ...approval, releaseId: 'other' }), refusal);
    await assert.rejects(guard({ ...approval, holdout: f.dev.digest }), refusal);
    const file = join(privateRoot, releaseId, 'holdout', 'dataset.json');
    await writeFile(file, Buffer.concat([f.sealed.bytes, Buffer.from('\n')]));
    await assert.rejects(guard(approval), refusal);
    await rm(file);
    await assert.rejects(guard(approval), refusal);
  } finally {
    await rm(temp, { recursive: true, force: true });
    await assert.rejects(access(temp), { code: 'ENOENT' });
  }
});
