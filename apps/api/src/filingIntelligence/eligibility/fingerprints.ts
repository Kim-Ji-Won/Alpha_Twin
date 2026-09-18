import { createHash } from 'node:crypto';

import { serializeJson } from '../persistence/fingerprints.js';
import { FilingEligibilityReason, FilingEligibilityStatus } from './contracts.js';
import { AdmissionDocument, decodingEvidence } from './representationAdmission.js';
import { FILING_RETRIEVAL_POLICY_V2, RepresentationPolicy } from './policies.js';

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

export interface AdmissionGeneration {
  readonly id: string;
  readonly profile_id: string;
  readonly schema_version: string;
  readonly normalizer_version: string;
  readonly text_search_config: string;
  readonly status: string;
  readonly chunk_count: number;
  readonly lexical_fingerprint: string;
  readonly total_lexeme_count: number;
}

export function calculateEligibilityFingerprintV2(
  document: AdmissionDocument,
  matched: RepresentationPolicy | null,
  state: { readonly status: FilingEligibilityStatus; readonly reasonCode: FilingEligibilityReason;
    readonly generation: AdmissionGeneration | null },
): string {
  const g = state.generation;
  return createHash('sha256').update(serializeJson({
    fingerprintSchema: 'filing-eligibility@2',
    retrievalPolicyId: FILING_RETRIEVAL_POLICY_V2.policyId,
    retrievalPolicyFingerprint: FILING_RETRIEVAL_POLICY_V2.fingerprint,
    representationPolicyId: matched?.policyId ?? null,
    representationPolicyFingerprint: matched?.fingerprint ?? null,
    documentId: document.id, receiptId: document.receipt_id,
    provider: document.provider, receiptNumber: document.receipt_number,
    sourceEntryHash: document.source_entry_hash,
    canonicalSchemaName: document.canonical_schema_name,
    canonicalSchemaVersion: document.canonical_schema_version,
    parserVersion: document.parser_version, chunkSchemaVersion: document.chunk_schema_version,
    chunkerVersion: document.chunker_version, canonicalFingerprint: document.canonical_fingerprint,
    chunkFingerprint: document.chunk_fingerprint, representationFingerprint: document.representation_fingerprint,
    sectionCount: document.section_count, blockCount: document.block_count, chunkCount: document.chunk_count,
    decoding: decodingEvidence(document), status: state.status, reasonCode: state.reasonCode,
    lexicalGeneration: g === null ? null : {
      id: g.id, profileId: g.profile_id, schemaVersion: g.schema_version,
      normalizerVersion: g.normalizer_version, textSearchConfig: g.text_search_config,
      status: g.status, chunkCount: g.chunk_count, lexicalFingerprint: g.lexical_fingerprint,
      totalLexemeCount: g.total_lexeme_count,
    },
  })).digest('hex');
}
