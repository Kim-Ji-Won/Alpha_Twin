import { createHash } from 'node:crypto';

import { canonicalSha256 } from './canonical.js';
import { DenseEvaluationError } from './contracts.js';
import { parseDatasetEnvelope } from './dataset.js';

export interface PendingReviewTarget {
  readonly releaseId: string;
  readonly versionId: string;
  readonly fileSha256: string;
  readonly canonicalHash: string;
}

const targetKeys = ['releaseId', 'versionId', 'fileSha256', 'canonicalHash'] as const;
const eventKeys = ['targetDigest', 'eventId', 'queryId', 'round', 'reviewedAt', 'reviewerRoleId', 'outcome'];
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const role = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const sha256 = /^[a-f0-9]{64}$/;

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new DenseEvaluationError('PRIVATE_HOLDOUT_REVIEW_LEDGER_INVALID');
}

// Ledger records come only from JSON.parse, never from caller-provided live objects.
function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireValid(typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
  return value as Record<string, unknown>;
}

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}

function utcSecond(value: unknown): string {
  requireValid(matches(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/));
  const iso = value.slice(0, -1) + '.000Z';
  requireValid(new Date(value).toISOString() === iso);
  return value;
}

/**
 * Consistency only: the caller supplies the expected target independently. Neither its
 * provenance nor human identity, append-only history or rollback protection is verified.
 * Sealing changes review metadata and therefore needs a new hash and separate approval.
 * This summary is not a sealing receipt or permission to run an evaluation.
 */
export function verifyPrivateHoldoutReviewLedger(
  pendingBytes: Uint8Array, ledgerJson: string, expected: PendingReviewTarget,
) {
  try {
    const { releaseId, versionId, fileSha256, canonicalHash } = expected;
    requireValid(matches(releaseId, identifier) && matches(versionId, identifier)
      && matches(fileSha256, sha256) && matches(canonicalHash, sha256));
    requireValid(pendingBytes instanceof Uint8Array && pendingBytes.byteLength > 0
      && pendingBytes.byteLength <= 16 * 1024 * 1024);
    const bytes = Buffer.from(pendingBytes);
    requireValid(createHash('sha256').update(bytes).digest('hex') === fileSha256);
    const dataset = parseDatasetEnvelope(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), 'holdout');
    const entries = dataset.payload.entries;
    requireValid(dataset.canonicalHash === canonicalHash && entries.length === 20
      && entries.every(e => e.review.status === 'pending' && e.review.reviewRoundCount === 0));

    requireValid(typeof ledgerJson === 'string' && ledgerJson.length <= 64 * 1024);
    const ledger = fields(JSON.parse(ledgerJson), ['target', 'events']);
    const target = fields(ledger.target, targetKeys);
    const binding = { releaseId, versionId, fileSha256, canonicalHash };
    requireValid(targetKeys.every(k => target[k] === binding[k]));
    const targetDigest = canonicalSha256(binding);
    requireValid(Array.isArray(ledger.events) && ledger.events.length === entries.length * 2);

    const rounds = new Map(entries.map(e => [e.queryId, new Map<number, string>()]));
    const eventIds = new Set<string>();
    for (const raw of ledger.events) {
      const e = fields(raw, eventKeys);
      requireValid(e.targetDigest === targetDigest && e.outcome === 'pass'
        && matches(e.eventId, identifier) && !eventIds.has(e.eventId)
        && matches(e.reviewerRoleId, role) && typeof e.queryId === 'string'
        && (e.round === 1 || e.round === 2));
      const item = rounds.get(e.queryId);
      requireValid(item && !item.has(e.round));
      item.set(e.round, utcSecond(e.reviewedAt));
      eventIds.add(e.eventId);
    }
    // Array order is immaterial; each item's second UTC instant must strictly follow its first.
    for (const item of rounds.values()) {
      const first = item.get(1), second = item.get(2);
      requireValid(first !== undefined && second !== undefined && first < second);
    }
    return { ...binding, queryCount: rounds.size, passedEventCount: eventIds.size };
  } catch {
    const error = new DenseEvaluationError('PRIVATE_HOLDOUT_REVIEW_LEDGER_INVALID');
    error.stack = error.name + ': ' + error.code;
    throw error;
  }
}
