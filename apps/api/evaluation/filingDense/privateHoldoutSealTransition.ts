import { createHash } from 'node:crypto';

import { canonicalSha256 } from './canonical.js';
import { DenseEvaluationError } from './contracts.js';
import { parseDatasetEnvelope } from './dataset.js';
import { type PendingReviewTarget, verifyPrivateHoldoutReviewLedger } from './privateHoldoutReviewLedger.js';

interface Digests {
  readonly fileSha256: string;
  readonly canonicalHash: string;
}

export interface SealTransitionExpected {
  readonly pending: PendingReviewTarget;
  readonly sealedCandidate: Digests;
}

interface VerifiedEvent {
  queryId: string;
  round: number;
  reviewedAt: string;
  reviewerRoleId: string;
}

const invalid = (): never => { throw new DenseEvaluationError('PRIVATE_HOLDOUT_SEAL_TRANSITION_INVALID'); };

function snapshot(input: Uint8Array): Uint8Array {
  if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > 16 * 1024 * 1024) return invalid();
  return new Uint8Array(input);
}

function boundPayload(bytes: Uint8Array, digests: Digests) {
  if (createHash('sha256').update(bytes).digest('hex') !== digests.fileSha256) return invalid();
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const envelope = parseDatasetEnvelope(raw, 'holdout');
  // Do not silently accept a different wire value normalized by the parser (e.g. targetCount).
  if (envelope.canonicalHash !== digests.canonicalHash || canonicalSha256(raw.payload) !== envelope.canonicalHash) {
    return invalid();
  }
  return envelope.payload;
}

/**
 * Checks consistency only. Neither externally supplied digests nor human identity/time
 * are authenticated here; the summary grants no seal, access or evaluation authority.
 */
export function verifyPrivateHoldoutSealTransition(
  pendingBytes: Uint8Array, sealedCandidateBytes: Uint8Array, ledgerJson: string, expected: SealTransitionExpected,
) {
  try {
    const pending = snapshot(pendingBytes), candidate = snapshot(sealedCandidateBytes);
    const { releaseId, versionId, fileSha256, canonicalHash } = expected.pending;
    const target = { releaseId, versionId, fileSha256, canonicalHash };
    const { fileSha256: sealedFileSha256, canonicalHash: sealedCanonicalHash } = expected.sealedCandidate;
    const { queryCount, passedEventCount } = verifyPrivateHoldoutReviewLedger(pending, ledgerJson, target);
    const payload = boundPayload(pending, target);
    boundPayload(candidate, { fileSha256: sealedFileSha256, canonicalHash: sealedCanonicalHash });

    // The same immutable JSON string was validated above, including every event and query binding.
    const { events } = JSON.parse(ledgerJson) as { events: VerifiedEvent[] };
    const seconds = new Map(events.filter(e => e.round === 2).map(e => [e.queryId, e]));
    const entries = payload.entries.map(entry => {
      const event = seconds.get(entry.queryId);
      if (!event) return invalid();
      return { ...entry, review: { status: 'sealed', reviewRoundCount: 2,
        reviewedAt: event.reviewedAt, reviewerRoleId: event.reviewerRoleId } };
    });
    if (canonicalSha256({ ...payload, entries }) !== sealedCanonicalHash) return invalid();
    return { releaseId, versionId, pendingFileSha256: fileSha256, pendingCanonicalHash: canonicalHash,
      sealedFileSha256, sealedCanonicalHash, queryCount, passedEventCount };
  } catch {
    const error = new DenseEvaluationError('PRIVATE_HOLDOUT_SEAL_TRANSITION_INVALID');
    error.stack = error.name + ': ' + error.code;
    throw error;
  }
}
