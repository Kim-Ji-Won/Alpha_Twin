import { createHash } from 'node:crypto';

import { serializeJson } from '../persistence/fingerprints.js';
import { FilingEligibilityReason, FilingEligibilityStatus } from './contracts.js';

export interface EligibilityFingerprintInput {
  readonly retrievalPolicyId: string;
  readonly retrievalPolicyFingerprint: string;
  readonly representationPolicyId: string;
  readonly representationPolicyFingerprint: string;
  readonly documentId: string;
  readonly receiptId: string;
  readonly provider: string;
  readonly receiptNumber: string;
  readonly sourceEntryHash: string;
  readonly canonicalSchemaName: string;
  readonly canonicalSchemaVersion: string;
  readonly parserVersion: string;
  readonly chunkSchemaVersion: string;
  readonly chunkerVersion: string;
  readonly canonicalFingerprint: string;
  readonly chunkFingerprint: string;
  readonly representationFingerprint: string;
  readonly sectionCount: number;
  readonly blockCount: number;
  readonly chunkCount: number;
  readonly status: FilingEligibilityStatus;
  readonly reasonCode: FilingEligibilityReason;
  readonly lexicalGeneration: null | {
    readonly id: string;
    readonly profileId: string;
    readonly schemaVersion: string;
    readonly normalizerVersion: string;
    readonly textSearchConfig: string;
    readonly status: string;
    readonly chunkCount: number;
    readonly lexicalFingerprint: string;
    readonly totalLexemeCount: number;
  };
}

export function calculateEligibilityFingerprint(
  input: EligibilityFingerprintInput,
): string {
  return createHash('sha256').update(serializeJson(input)).digest('hex');
}
