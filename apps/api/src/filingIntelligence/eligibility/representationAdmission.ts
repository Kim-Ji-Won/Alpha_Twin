import { createHash } from 'node:crypto';
import { filingRepresentationIdentitySeed, LEGACY_FILING_DECODING_PROFILE } from '../../openDart/document/filingXmlDecoding.js';
import { FilingEligibilityError } from './errors.js';
import { allowedRepresentationPolicies, FILING_RETRIEVAL_POLICY_V2, RepresentationPolicy, RetrievalPolicy } from './policies.js';

export interface AdmissionDocument {
  readonly id: string;
  readonly receipt_id: string;
  readonly provider: string;
  readonly receipt_number: string;
  readonly source_entry_hash: string;
  readonly canonical_schema_name: string;
  readonly canonical_schema_version: string;
  readonly parser_version: string;
  readonly chunk_schema_version: string;
  readonly chunker_version: string;
  readonly decoding_profile_id: string | null;
  readonly decoding_profile_fingerprint: string | null;
  readonly source_declared_encoding: string | null;
  readonly source_bom_kind: string | null;
  readonly source_utf8_validity: string | null;
  readonly canonical_utf8_hash: string | null;
  readonly decoder_runtime_label: string | null;
  readonly decoding_compatibility_reason: string | null;
  readonly canonical_fingerprint: string;
  readonly chunk_fingerprint: string;
  readonly representation_fingerprint: string;
  readonly section_count: number;
  readonly block_count: number;
  readonly chunk_count: number;
}

const HASH = /^[0-9a-f]{64}$/;
export function admissionIntegrityFailure(): never {
  throw new FilingEligibilityError('FILING_ELIGIBILITY_REPRESENTATION_INTEGRITY_FAILURE', false);
}

export function decodingEvidence(document: AdmissionDocument) {
  return {
    decodingProfileId: document.decoding_profile_id,
    decodingProfileFingerprint: document.decoding_profile_fingerprint,
    sourceDeclaredEncoding: document.source_declared_encoding,
    sourceBomKind: document.source_bom_kind,
    sourceUtf8Validity: document.source_utf8_validity,
    sourceEntrySha256: document.source_entry_hash,
    canonicalUtf8Sha256: document.canonical_utf8_hash,
    decoderRuntimeLabel: document.decoder_runtime_label,
    compatibilityReason: document.decoding_compatibility_reason,
  };
}

export function matchRepresentation(
  document: AdmissionDocument,
  policy: RetrievalPolicy,
): RepresentationPolicy | null {
  const allowed = allowedRepresentationPolicies(policy);
  if (!document || ![document.source_entry_hash, document.canonical_fingerprint,
    document.chunk_fingerprint, document.representation_fingerprint].every(value =>
    typeof value === 'string' && HASH.test(value))
    || ![document.section_count, document.block_count, document.chunk_count].every(value =>
      Number.isSafeInteger(value) && value >= 0)
    || ![document.canonical_schema_name, document.canonical_schema_version,
      document.parser_version, document.chunk_schema_version, document.chunker_version]
      .every(value => typeof value === 'string' && value.length > 0)) admissionIntegrityFailure();
  const provenance = decodingEvidence(document);
  const legacy = document.decoding_profile_id !== null;
  if (!legacy) {
    const { sourceEntrySha256: _source, ...nullable } = provenance;
    if (Object.values(nullable).some(value => value !== null)) admissionIntegrityFailure();
  } else if (document.decoding_profile_id !== LEGACY_FILING_DECODING_PROFILE.profileId
    || document.decoding_profile_fingerprint !== LEGACY_FILING_DECODING_PROFILE.fingerprint
    || !LEGACY_FILING_DECODING_PROFILE.acceptedDeclaredEncodings.some(value =>
      value === document.source_declared_encoding)
    || document.source_bom_kind !== 'none' || document.source_utf8_validity !== 'invalid'
    || typeof document.canonical_utf8_hash !== 'string' || !HASH.test(document.canonical_utf8_hash)
    || document.decoder_runtime_label !== 'node-whatwg-textdecoder:euc-kr'
    || document.decoding_compatibility_reason !== 'declaration-actual-byte-mismatch') {
    admissionIntegrityFailure();
  }
  const matches = allowed.filter(candidate =>
    document.canonical_schema_name === candidate.canonicalSchemaName
    && document.canonical_schema_version === candidate.canonicalSchemaVersion
    && document.parser_version === candidate.parserVersion
    && document.chunk_schema_version === candidate.chunkSchemaVersion
    && document.chunker_version === candidate.chunkerVersion
    && ('decodingProfileId' in candidate
      ? legacy && document.decoding_profile_id === candidate.decodingProfileId
        && document.decoding_profile_fingerprint === candidate.decodingProfileFingerprint
      : !legacy));
  if (matches.length > 1) admissionIntegrityFailure();
  return matches[0] ?? null;
}

// Validate persisted identity; never regenerate or write canonical chunks.
export function verifyAdmissionChunks(document: AdmissionDocument, chunks: readonly {
  readonly content_hash: string; readonly retrieval_text: string;
}[]): void {
  if (!matchRepresentation(document, FILING_RETRIEVAL_POLICY_V2)) admissionIntegrityFailure();
  if (chunks.length !== document.chunk_count) admissionIntegrityFailure();
  const provenance = document.decoding_profile_id === null ? undefined : {
    decodingProfileId: LEGACY_FILING_DECODING_PROFILE.profileId,
    decodingProfileFingerprint: document.decoding_profile_fingerprint!,
    sourceDeclaredEncoding: document.source_declared_encoding as 'utf-8' | 'utf8',
    sourceBomKind: 'none' as const,
    sourceUtf8Validity: 'invalid' as const,
    sourceEntrySha256: document.source_entry_hash,
    canonicalUtf8Sha256: document.canonical_utf8_hash!,
    decoderRuntimeLabel: 'node-whatwg-textdecoder:euc-kr' as const,
    compatibilityReason: 'declaration-actual-byte-mismatch' as const,
  };
  const seed = filingRepresentationIdentitySeed(document.parser_version, provenance);
  for (const chunk of chunks) {
    if (typeof chunk.retrieval_text !== 'string' || createHash('sha256')
      .update([seed, document.chunker_version, chunk.retrieval_text].join('\u001f'))
      .digest('hex') !== chunk.content_hash) admissionIntegrityFailure();
  }
}
