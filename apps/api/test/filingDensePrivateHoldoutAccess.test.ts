import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { canonicalSha256 } from '../evaluation/filingDense/canonical.js';
import { DENSE_EVAL_CATEGORIES, DenseEvaluationError,
  type DenseEvalDatasetPayload, type DenseEvalEntry, type DenseEvalSplit } from '../evaluation/filingDense/contracts.js';
import { verifyPrivateHoldoutRelease, type PrivateReleaseApproval } from '../evaluation/filingDense/privateHoldoutAccess.js';

const sentinel = 'PRIVATE_QUERY_SENTINEL';
const releaseId = 'synthetic-v1';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

function entries(split: DenseEvalSplit, count: number): DenseEvalEntry[] {
  return Array.from({ length: count }, (_, i) => {
    const company = { corpCode: String(i % 2 + 1).padStart(8, '0'), symbol: String(i % 2 + 1).padStart(6, '0') };
    return {
      queryId: (split === 'dev' ? 'DEV-' : 'HOLD-') + String(i + 1).padStart(3, '0'),
      queryText: sentinel + i, split, categories: DENSE_EVAL_CATEGORIES, company,
      reportFamily: 'annual', evidenceModality: 'table', currentEffectiveCorrection: false,
      evidenceGroups: [{ evidenceGroupId: 'G1', grade: 2, acceptableChunks: [{
        ...company, provider: 'opendart-fss', receiptNumber: '00000000000000', documentId: 'synthetic',
        chunkId: 'mock-' + i, contentHash: hash('mock-content'), representationFingerprint: hash('mock-rep'),
        parserVersion: 'test', chunkerVersion: 'test', schemaVersion: 'test',
        sectionPath: [sentinel], locator: { ordinal: i },
      }] }],
      review: { status: split === 'dev' ? 'reviewed' : 'sealed', reviewRoundCount: split === 'dev' ? 1 : 2,
        reviewedAt: '2000-01-01T00:00:00Z', reviewerRoleId: 'synthetic-review' },
    };
  });
}

function fixture(split: DenseEvalSplit, rows: DenseEvalEntry[]) {
  const payload: DenseEvalDatasetPayload = { datasetId: 'dense-eval-v1', schemaVersion: 'dense-eval-dataset@1',
    split, targetCount: split === 'dev' ? 40 : 20, entries: rows };
  const canonicalHash = canonicalSha256(payload);
  const bytes = JSON.stringify({ payload, canonicalHash });
  return { bytes, digest: { canonicalHash, fileSha256: hash(bytes) } };
}

async function setup(t: TestContext, devRows = entries('dev', 40), holdoutRows = entries('holdout', 20)) {
  const temp = await mkdtemp(join(await realpath(tmpdir()), 'private-guard-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const repositoryRoot = join(temp, 'repo');
  const privateRoot = join(temp, 'repo-private');
  const release = join(privateRoot, releaseId);
  const file = (split: DenseEvalSplit) => join(release, split, 'dataset.json');
  await mkdir(join(repositoryRoot, '.git'), { recursive: true });
  const dev = fixture('dev', devRows), holdout = fixture('holdout', holdoutRows);
  for (const [split, bytes] of [['dev', dev.bytes], ['holdout', holdout.bytes]] as const) {
    await mkdir(dirname(file(split)), { recursive: true });
    await writeFile(file(split), bytes);
  }
  const request = { repositoryRoot, privateRoot, releaseId };
  const approval: PrivateReleaseApproval = { finalEvaluationAuthorized: true, privateRoot, releaseId,
    dev: dev.digest, holdout: holdout.digest };
  return { request, approval, file, temp, release, holdout };
}

async function deny(operation: ReturnType<typeof verifyPrivateHoldoutRelease>) {
  await assert.rejects(operation, (err: unknown) => {
    assert.ok(err instanceof DenseEvaluationError);
    assert.equal(err.message, 'PRIVATE_HOLDOUT_ACCESS_DENIED');
    assert.equal(err.stack, err.name + ': PRIVATE_HOLDOUT_ACCESS_DENIED');
    assert.equal(err.cause, undefined);
    assert.ok(!JSON.stringify(err).includes(sentinel));
    return true;
  });
}

test('only aggregate validation leaves the guard; warnings are not benchmark approval', async t => {
  const { request, approval } = await setup(t);
  const result = await verifyPrivateHoldoutRelease(request, approval);
  assert.deepEqual(result, { releaseId, devCount: 40, holdoutCount: 20,
    devCanonicalHash: approval.dev.canonicalHash, holdoutCanonicalHash: approval.holdout.canonicalHash,
    coverageWarnings: ['CORRECTION_TARGET_NOT_MET', 'REPORT_FAMILY_TARGET_NOT_MET', 'MODALITY_TARGET_NOT_MET'] });
  assert.ok(!JSON.stringify(result).includes(sentinel));
});

test('authorization, root binding and release identity must be explicit', async t => {
  const { request, approval, temp } = await setup(t);
  await deny(verifyPrivateHoldoutRelease(request, undefined as unknown as PrivateReleaseApproval));
  await deny(verifyPrivateHoldoutRelease(request, { ...approval, finalEvaluationAuthorized: false }));
  await deny(verifyPrivateHoldoutRelease({ ...request, privateRoot: '' }, approval));
  await deny(verifyPrivateHoldoutRelease(request, { ...approval, privateRoot: temp }));
  await deny(verifyPrivateHoldoutRelease(request, { ...approval, releaseId: 'synthetic-v2' }));
  for (const id of ['..', '../sibling', '/absolute']) {
    await deny(verifyPrivateHoldoutRelease({ ...request, releaseId: id }, { ...approval, releaseId: id }));
  }
});

test('repository, public fixture and missing root cannot be used as private custody', async t => {
  const { request, approval, temp, release } = await setup(t);
  for (const root of [request.repositoryRoot, join(request.repositoryRoot, 'public-fixture')]) {
    await mkdir(root, { recursive: true });
    await rename(release, join(root, releaseId));
    try { await deny(verifyPrivateHoldoutRelease({ ...request, privateRoot: root }, { ...approval, privateRoot: root })); }
    finally { await rename(join(root, releaseId), release); }
  }
  for (const root of [join(temp, 'missing'), temp]) {
    await deny(verifyPrivateHoldoutRelease({ ...request, privateRoot: root }, { ...approval, privateRoot: root }));
  }
});

test('symlinks at root, release, split and file are rejected even with identical approved bytes', async t => {
  const { request, approval, file, temp, release } = await setup(t);
  for (const p of [request.privateRoot, release, dirname(file('holdout')), file('holdout')]) {
    const outside = join(temp, 'elsewhere');
    await rename(p, outside);
    await symlink(outside, p);
    try { await deny(verifyPrivateHoldoutRelease(request, approval)); }
    finally { await rm(p); await rename(outside, p); }
  }
  await link(file('holdout'), join(temp, 'second-name'));
  await deny(verifyPrivateHoldoutRelease(request, approval));
});

test('each split requires both independently approved digests', async t => {
  const { request, approval } = await setup(t);
  for (const split of ['dev', 'holdout'] as const) {
    for (const field of ['fileSha256', 'canonicalHash'] as const) {
      await deny(verifyPrivateHoldoutRelease(request, { ...approval, [split]: { ...approval[split], [field]: hash('wrong') } }));
    }
  }
});

test('approved file hash cannot override the split, schema or dataset identity', async t => {
  const { request, approval, file, holdout } = await setup(t);
  for (const patch of [{ split: 'dev' }, { schemaVersion: 'unknown' }, { datasetId: 'unknown' }]) {
    const payload = { ...JSON.parse(holdout.bytes).payload, ...patch };
    const canonicalHash = canonicalSha256(payload);
    const bytes = JSON.stringify({ payload, canonicalHash });
    await writeFile(file('holdout'), bytes);
    await deny(verifyPrivateHoldoutRelease(request, { ...approval, holdout: { canonicalHash, fileSha256: hash(bytes) } }));
  }
});

test('full counts and approved hashes do not override a coverage hard error', async t => {
  const narrow = (split: DenseEvalSplit, n: number) => entries(split, n).map(e => ({ ...e, categories: ['numeric'] as const }));
  const { request, approval } = await setup(t, narrow('dev', 40), narrow('holdout', 20));
  await deny(verifyPrivateHoldoutRelease(request, approval));
});

test('consistent internal rehash does not replace external approval; whitespace also changes byte identity', async t => {
  const { request, approval, file, holdout } = await setup(t);
  await writeFile(file('holdout'), holdout.bytes + '\n');
  await deny(verifyPrivateHoldoutRelease(request, approval));
  const rows = entries('holdout', 20);
  rows[0] = { ...rows[0]!, queryText: 'different synthetic text' };
  const modified = fixture('holdout', rows);
  await writeFile(file('holdout'), modified.bytes);
  await deny(verifyPrivateHoldoutRelease(request, approval));
  await deny(verifyPrivateHoldoutRelease(request, { ...approval,
    holdout: { ...approval.holdout, fileSha256: modified.digest.fileSha256 } }));
});

for (const [split, count, condition] of [
  ['holdout', 0, 'count'], ['holdout', 19, 'count'], ['dev', 39, 'count'],
  ['holdout', 20, 'pending'], ['holdout', 20, 'one round'], ['dev', 40, 'pending'],
] as const) {
  test('reject approved bytes with ' + [split, count, condition].join(' '), async t => {
    const rows = entries(split, count);
    if (condition === 'pending') rows[0] = { ...rows[0]!, review: { status: 'pending', reviewRoundCount: 0 } };
    if (condition === 'one round') rows[0] = { ...rows[0]!, review: { ...rows[0]!.review, reviewRoundCount: 1 } };
    const { request, approval } = await setup(t, split === 'dev' ? rows : undefined, split === 'holdout' ? rows : undefined);
    await deny(verifyPrivateHoldoutRelease(request, approval));
  });
}

test('parser and filesystem errors are sanitized, without fallback to dev alone', async t => {
  const { request, approval, file } = await setup(t);
  await writeFile(file('holdout'), sentinel);
  await deny(verifyPrivateHoldoutRelease(request, { ...approval, holdout: { ...approval.holdout, fileSha256: hash(sentinel) } }));
  await rm(file('holdout'));
  await deny(verifyPrivateHoldoutRelease(request, approval));
});
