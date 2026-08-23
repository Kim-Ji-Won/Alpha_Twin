import { createHash } from 'node:crypto';

import { serializeJson } from '../persistence/fingerprints.js';
import {
  ActivationFingerprintInput,
  FilingRetrievalActivationEvent,
  FilingRetrievalActivationReason,
} from './contracts.js';

function sha256(value: unknown): string {
  return createHash('sha256').update(serializeJson(value)).digest('hex');
}

export function activationFingerprint(input: ActivationFingerprintInput): string {
  return sha256({ fingerprintVersion: 'filing-retrieval-activation@1', ...input });
}

export function activationEventFingerprint(input: {
  readonly activation: ActivationFingerprintInput;
  readonly activationFingerprint: string;
  readonly eventType: FilingRetrievalActivationEvent;
  readonly reasonCode: FilingRetrievalActivationReason;
  readonly previousReceiptId: string | null;
  readonly previousDocumentId: string | null;
}): string {
  return sha256({ fingerprintVersion: 'filing-retrieval-activation-event@1', ...input });
}
