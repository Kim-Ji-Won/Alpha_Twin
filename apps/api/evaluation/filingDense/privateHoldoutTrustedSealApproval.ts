import { createHash, createPublicKey, verify } from 'node:crypto';

import { canonicalJson } from './canonical.js';
import { DenseEvaluationError } from './contracts.js';
import { verifyPrivateHoldoutSealTransition } from './privateHoldoutSealTransition.js';

const idFields = ['approvalId', 'releaseId', 'pendingVersionId', 'sealedVersionId'] as const;
const digestFields = ['pendingFileSha256', 'pendingCanonicalHash', 'ledgerFileSha256',
  'sealedFileSha256', 'sealedCanonicalHash'] as const;
const fields = ['schema', 'purpose', ...idFields, ...digestFields] as const;
type Identifiers = Readonly<Record<typeof idFields[number], string>>;
type Manifest = Identifiers & Readonly<Record<typeof digestFields[number], string>> & {
  readonly schema: 'private-holdout-seal-approval@1';
  readonly purpose: 'seal-transition';
};

// Supplied independently of the artifacts; distribution and provenance are the caller's responsibility.
export interface TrustedSealContext extends Identifiers {
  readonly publicKeySpkiDer: Uint8Array;
  readonly manifestSha256: string;
}

export interface SealApprovalArtifacts {
  readonly manifestBytes: Uint8Array;
  readonly signatureBytes: Uint8Array;
  readonly pendingBytes: Uint8Array;
  readonly ledgerBytes: Uint8Array;
  readonly sealedCandidateBytes: Uint8Array;
}

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new DenseEvaluationError('PRIVATE_HOLDOUT_TRUSTED_SEAL_APPROVAL_INVALID');
}

function snapshot(value: Uint8Array, max: number) {
  requireValid(value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= max);
  return Buffer.from(new Uint8Array(value).buffer);
}

function decode(bytes: Buffer) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

function parseManifest(bytes: Buffer): Manifest {
  const m = JSON.parse(decode(bytes));
  requireValid(m !== null && typeof m === 'object' && !Array.isArray(m)
    && Object.keys(m).length === fields.length && fields.every(k => Object.hasOwn(m, k)));
  requireValid(m.schema === 'private-holdout-seal-approval@1' && m.purpose === 'seal-transition');
  for (const k of idFields) requireValid(typeof m[k] === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(m[k]));
  for (const k of digestFields) requireValid(typeof m[k] === 'string' && /^[a-f0-9]{64}$/.test(m[k]));
  requireValid(m.pendingVersionId !== m.sealedVersionId && bytes.equals(Buffer.from(canonicalJson(m), 'utf8')));
  return m;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * Checks a seal-transition signature, not human identity, time, access or final-run permission.
 * Stateless: rechecking the same approved inputs is allowed. No sealing or replay store.
 */
export function verifyPrivateHoldoutTrustedSealApproval(input: SealApprovalArtifacts, trusted: TrustedSealContext) {
  try {
    const manifest = snapshot(input.manifestBytes, 4096);
    const manifestSha256 = sha256(manifest);
    requireValid(manifestSha256 === trusted.manifestSha256);
    const signature = snapshot(input.signatureBytes, 64);
    requireValid(signature.length === 64);
    const der = snapshot(trusted.publicKeySpkiDer, 256);
    const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
    // Accept only canonical Ed25519 SPKI DER: no alternate encoding or ignored suffix.
    requireValid(key.type === 'public' && key.asymmetricKeyType === 'ed25519'
      && der.equals(key.export({ format: 'der', type: 'spki' })));
    requireValid(verify(null, manifest, key, signature));
    const m = parseManifest(manifest);
    requireValid(idFields.every(k => m[k] === trusted[k]));

    const ledger = snapshot(input.ledgerBytes, 64 * 1024);
    requireValid(sha256(ledger) === m.ledgerFileSha256);
    const { queryCount, passedEventCount } = verifyPrivateHoldoutSealTransition(
      snapshot(input.pendingBytes, 16 * 1024 * 1024), snapshot(input.sealedCandidateBytes, 16 * 1024 * 1024),
      decode(ledger), { pending: { releaseId: m.releaseId, versionId: m.pendingVersionId,
        fileSha256: m.pendingFileSha256, canonicalHash: m.pendingCanonicalHash },
      sealedCandidate: { fileSha256: m.sealedFileSha256, canonicalHash: m.sealedCanonicalHash } },
    );
    return { approvalId: m.approvalId, manifestSha256, queryCount, passedEventCount };
  } catch {
    const error = new DenseEvaluationError('PRIVATE_HOLDOUT_TRUSTED_SEAL_APPROVAL_INVALID');
    error.stack = error.name + ': ' + error.code;
    throw error;
  }
}
