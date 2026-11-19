import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';

import { DenseEvaluationError, type DenseEvalSplit } from './contracts.js';
import { assessDatasetReadiness, evaluateDatasetCoverage, parseDatasetEnvelope } from './dataset.js';

interface ApprovedDigest {
  readonly canonicalHash: string;
  readonly fileSha256: string;
}

// Supplied by a separate trusted channel. This module does not authenticate that channel.
export interface PrivateReleaseApproval {
  readonly finalEvaluationAuthorized: boolean;
  readonly privateRoot: string;
  readonly releaseId: string;
  readonly dev: ApprovedDigest;
  readonly holdout: ApprovedDigest;
}

export interface PrivateReleaseRequest {
  readonly repositoryRoot: string;
  readonly privateRoot: string;
  readonly releaseId: string;
}

function denied(): DenseEvaluationError {
  const error = new DenseEvaluationError('PRIVATE_HOLDOUT_ACCESS_DENIED');
  error.stack = error.name + ': ' + error.code;
  return error;
}

function digest(value: ApprovedDigest): ApprovedDigest {
  const { canonicalHash, fileSha256 } = value;
  for (const hash of [canonicalHash, fileSha256]) {
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw denied();
  }
  return { canonicalHash, fileSha256 };
}

function normalizedAbsolute(path: string): boolean {
  return typeof path === 'string' && isAbsolute(path) && resolve(path) === path && path !== parse(path).root;
}

// Compare filesystem identities as well as canonical paths (case aliases on macOS).
async function directoryChain(path: string, excludeCheckout = false): Promise<string[]> {
  if (!normalizedAbsolute(path) || await realpath(path) !== path) throw denied();
  const chain: string[] = [];
  for (let p = path; ; p = dirname(p)) {
    const st = await lstat(p, { bigint: true });
    if (!st.isDirectory()) throw denied();
    if (excludeCheckout && await lstat(join(p, '.git')).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    })) throw denied();
    chain.push(st.dev + ':' + st.ino);
    if (p === dirname(p)) return chain;
  }
}

async function readSplit(root: string, id: string, split: DenseEvalSplit, approved: ApprovedDigest) {
  const directory = join(root, id, split);
  const before = await directoryChain(directory, true);
  const sameDirectory = async () =>
    (await directoryChain(directory, true)).every((identity, i) => identity === before[i]);
  const file = join(directory, 'dataset.json');
  const expected = await lstat(file, { bigint: true });
  if (!expected.isFile() || expected.nlink !== 1n || await realpath(file) !== file) throw denied();
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = await handle.stat({ bigint: true });
    if (!st.isFile() || st.dev !== expected.dev || st.ino !== expected.ino || st.nlink !== 1n
      || st.size <= 0n || st.size > 16n * 1024n * 1024n || !await sameDirectory()) throw denied();
    const bytes = Buffer.alloc(Number(st.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw denied();
      offset += bytesRead;
    }
    const end = await lstat(file, { bigint: true });
    if (end.dev !== st.dev || end.ino !== st.ino || st.ctimeNs !== end.ctimeNs
      || !await sameDirectory()
      || createHash('sha256').update(bytes).digest('hex') !== approved.fileSha256) throw denied();
    const data = parseDatasetEnvelope(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), split);
    if (data.canonicalHash !== approved.canonicalHash) throw denied();
    return data;
  } finally {
    await handle.close();
  }
}

// Validation only; keep the private tree stable and inaccessible to untrusted writers.
// A later runner must consume the verified data in-process, not treat this receipt as a token.
export async function verifyPrivateHoldoutRelease(request: PrivateReleaseRequest, approval: PrivateReleaseApproval) {
  try {
    const { privateRoot, repositoryRoot, releaseId } = request;
    if (approval.finalEvaluationAuthorized !== true || privateRoot !== approval.privateRoot
      || typeof releaseId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(releaseId)
      || releaseId !== approval.releaseId) throw denied();
    const devDigest = digest(approval.dev);
    const holdoutDigest = digest(approval.holdout);
    const repo = await directoryChain(repositoryRoot);
    const custody = await directoryChain(privateRoot);
    if (custody.includes(repo[0]!) || repo.includes(custody[0]!)) throw denied();
    const dev = await readSplit(privateRoot, releaseId, 'dev', devDigest);
    const holdout = await readSplit(privateRoot, releaseId, 'holdout', holdoutDigest);
    if (!assessDatasetReadiness(dev, holdout).ready) throw denied();
    const { warnings } = evaluateDatasetCoverage([...dev.payload.entries, ...holdout.payload.entries]);
    return { releaseId, devCount: dev.payload.entries.length, holdoutCount: holdout.payload.entries.length,
      devCanonicalHash: dev.canonicalHash, holdoutCanonicalHash: holdout.canonicalHash, coverageWarnings: warnings };
  } catch {
    // Neither parser input nor OS errors (which may include paths) cross this boundary.
    throw denied();
  }
}
