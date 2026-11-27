import { createHash } from 'node:crypto';

import { DenseEvaluationError, type DenseEvalSplit } from './contracts.js';
import { assessDatasetReadiness, evaluateDatasetCoverage, parseDatasetEnvelope } from './dataset.js';
import { verifyPrivateHoldoutTrustedSealApproval, type SealApprovalArtifacts,
  type TrustedSealContext } from './privateHoldoutTrustedSealApproval.js';

interface DevDigests {
  readonly fileSha256: string;
  readonly canonicalHash: string;
}

const datasetLimit = 16 * 1024 * 1024;
const invalid = (): never => { throw new DenseEvaluationError('PRIVATE_HOLDOUT_RELEASE_CANDIDATE_INVALID'); };
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function copy(bytes: Uint8Array, max: number, min = 1) {
  if (!(bytes instanceof Uint8Array)) return invalid();
  const size = bytes.byteLength;
  if (!Number.isSafeInteger(size) || size < min || size > max) return invalid();
  const owned = new Uint8Array(size);
  owned.set(bytes);
  return owned;
}

function parse(bytes: Uint8Array, split: DenseEvalSplit) {
  return parseDatasetEnvelope(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), split);
}

/**
 * In-memory consistency only. Expected digests and trust must be supplied independently.
 * This summary does not authorize access, publication or a run. A future publisher
 * must consume its own verified snapshots in the same operation, not reopen inputs.
 */
export function verifyPrivateHoldoutReleaseCandidate(input: SealApprovalArtifacts, trusted: TrustedSealContext,
  devBytes: Uint8Array, expectedDev: DevDigests) {
  try {
    const { fileSha256, canonicalHash } = expectedDev;
    const { approvalId, releaseId, pendingVersionId, sealedVersionId, manifestSha256 } = trusted;
    const context = { approvalId, releaseId, pendingVersionId, sealedVersionId, manifestSha256,
      publicKeySpkiDer: copy(trusted.publicKeySpkiDer, 256) };
    const devSnapshot = copy(devBytes, datasetLimit);
    const artifacts = { manifestBytes: copy(input.manifestBytes, 4096), signatureBytes: copy(input.signatureBytes, 64, 64),
      pendingBytes: copy(input.pendingBytes, datasetLimit), sealedCandidateBytes: copy(input.sealedCandidateBytes, datasetLimit),
      ledgerBytes: copy(input.ledgerBytes, 64 * 1024) };

    if (sha256(devSnapshot) !== fileSha256) return invalid();
    const seal = verifyPrivateHoldoutTrustedSealApproval(artifacts, context);
    const dev = parse(devSnapshot, 'dev'), holdout = parse(artifacts.sealedCandidateBytes, 'holdout');
    if (dev.canonicalHash !== canonicalHash || !assessDatasetReadiness(dev, holdout).ready) return invalid();
    const { warnings } = evaluateDatasetCoverage([...dev.payload.entries, ...holdout.payload.entries]);
    return { releaseId, sealedVersionId, approvalId: seal.approvalId, manifestSha256: seal.manifestSha256,
      devFileSha256: fileSha256, devCanonicalHash: dev.canonicalHash,
      holdoutFileSha256: sha256(artifacts.sealedCandidateBytes), holdoutCanonicalHash: holdout.canonicalHash,
      devCount: dev.payload.entries.length, holdoutCount: holdout.payload.entries.length,
      passedEventCount: seal.passedEventCount, coverageWarnings: warnings };
  } catch {
    const error = new DenseEvaluationError('PRIVATE_HOLDOUT_RELEASE_CANDIDATE_INVALID');
    error.stack = error.name + ': ' + error.code;
    throw error;
  }
}
