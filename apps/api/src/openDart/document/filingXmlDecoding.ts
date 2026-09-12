import { createHash } from 'node:crypto';

import { OpenDartError, OpenDartErrorCode } from '../errors.js';
import {
  decodeSafeFilingXml,
  FilingXmlBomKind,
  inspectFilingXmlEncoding,
  validateDecodedFilingXmlText,
} from './filingXmlSafety.js';
import { FilingDecodingProvenance } from './canonicalFilingContracts.js';

export const LEGACY_FILING_DECODING_PROFILE_ID =
  'opendart-korean-legacy-compatible-v1' as const;

const profileDefinition = Object.freeze({
  profileId: LEGACY_FILING_DECODING_PROFILE_ID,
  semanticsVersion: '1',
  sourceAuthority: 'validated-opendart-filing-main-entry',
  acceptedDeclaredEncodings: ['utf-8', 'utf8'] as const,
  acceptedBomKind: 'none',
  requiresStrictUtf8Failure: true,
  decoderRuntime: 'node-whatwg-textdecoder',
  minimumNodeMajor: 22,
  decoderLabel: 'euc-kr',
  fatalDecode: true,
  replacementPolicy: 'reject-u+fffd',
  xmlSafetyPolicy: 'existing-filing-xml-safety',
  canonicalEncoding: 'utf-8',
  declarationNormalization: 'encoding-attribute-to-utf-8',
  parserCompatibility:
    'legacy-cr-entity-and-korean-angle-label-normalization',
});

function stableProfileJson(): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(profileDefinition).sort(([left], [right]) => left.localeCompare(right)),
  ));
}

export const LEGACY_FILING_DECODING_PROFILE = Object.freeze({
  ...profileDefinition,
  fingerprint: createHash('sha256').update(stableProfileJson()).digest('hex'),
});

export interface OpenDartDecodedMainEntry {
  readonly text: string;
  readonly canonicalUtf8Bytes: Buffer;
  readonly hadBom: boolean;
  readonly provenance?: FilingDecodingProvenance;
}

export interface OpenDartMainEntryAuthority {
  readonly provider: 'opendart-fss';
  readonly safeArchiveValidated: true;
  readonly mainEntrySelected: true;
  readonly sourceEntrySha256: string;
}

function decodingError(code: OpenDartErrorCode, cause?: unknown): OpenDartError {
  return new OpenDartError(
    code,
    'filing-document',
    false,
    undefined,
    cause instanceof Error ? { cause } : undefined,
  );
}

function normalizeUtf8Declaration(text: string): string {
  return text.replace(
    /^(\s*<\?xml\b[\s\S]*?\bencoding\s*=\s*)(['"])(?:utf-8|utf8)\2([\s\S]*?\?>)/i,
    '$1$2utf-8$2$3',
  );
}

function assertProfileIntegrity(): void {
  const actual = createHash('sha256').update(stableProfileJson()).digest('hex');
  if (actual !== LEGACY_FILING_DECODING_PROFILE.fingerprint) {
    throw decodingError('OPENDART_DOCUMENT_DECODING_PROFILE_MISMATCH');
  }
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  if (!Number.isSafeInteger(nodeMajor)
    || nodeMajor < LEGACY_FILING_DECODING_PROFILE.minimumNodeMajor) {
    throw decodingError('OPENDART_DOCUMENT_DECODING_PROFILE_MISMATCH');
  }
}

function assertLegacyTrigger(
  inspection: ReturnType<typeof inspectFilingXmlEncoding>,
  authority: OpenDartMainEntryAuthority,
): asserts inspection is { readonly bomKind: 'none'; readonly declaredEncoding: 'utf-8' | 'utf8' } {
  if (
    authority.provider !== 'opendart-fss'
    || authority.safeArchiveValidated !== true
    || authority.mainEntrySelected !== true
    || inspection.bomKind !== 'none'
    || (inspection.declaredEncoding !== 'utf-8' && inspection.declaredEncoding !== 'utf8')
  ) {
    throw decodingError('OPENDART_DOCUMENT_LEGACY_ENCODING_NOT_ELIGIBLE');
  }
}

export function decodeValidatedOpenDartMainEntry(
  bytes: Buffer,
  authority: OpenDartMainEntryAuthority,
): OpenDartDecodedMainEntry {
  try {
    const decoded = decodeSafeFilingXml(bytes);
    return {
      text: decoded.text,
      canonicalUtf8Bytes: Buffer.from(decoded.text, 'utf8'),
      hadBom: decoded.hadBom,
    };
  } catch (error) {
    if (!(error instanceof OpenDartError)
      || error.code !== 'OPENDART_DOCUMENT_INVALID_XML_ENCODING') {
      throw error;
    }
  }

  const inspection = inspectFilingXmlEncoding(bytes);
  if (bytes.includes(0)) {
    throw decodingError('OPENDART_DOCUMENT_LEGACY_ENCODING_NOT_ELIGIBLE');
  }
  assertLegacyTrigger(inspection, authority);
  assertProfileIntegrity();

  let decodedText: string;
  try {
    decodedText = new TextDecoder('euc-kr', { fatal: true }).decode(bytes);
  } catch (error) {
    throw decodingError('OPENDART_DOCUMENT_LEGACY_DECODE_FAILED', error);
  }
  if (decodedText.includes('\ufffd')) {
    throw decodingError('OPENDART_DOCUMENT_LEGACY_DECODE_FAILED');
  }
  try {
    validateDecodedFilingXmlText(decodedText);
  } catch (error) {
    throw decodingError('OPENDART_DOCUMENT_LEGACY_XML_SAFETY_FAILED', error);
  }

  const text = normalizeUtf8Declaration(decodedText);
  let canonicalUtf8Bytes: Buffer;
  try {
    canonicalUtf8Bytes = Buffer.from(text, 'utf8');
    if (new TextDecoder('utf-8', { fatal: true }).decode(canonicalUtf8Bytes) !== text) {
      throw new Error('UTF-8 round trip mismatch');
    }
  } catch (error) {
    throw decodingError('OPENDART_DOCUMENT_CANONICAL_ENCODING_FAILED', error);
  }
  const sourceEntrySha256 = createHash('sha256').update(bytes).digest('hex');
  if (sourceEntrySha256 !== authority.sourceEntrySha256) {
    throw decodingError('OPENDART_DOCUMENT_PROVENANCE_MISMATCH');
  }
  const canonicalUtf8Sha256 = createHash('sha256').update(canonicalUtf8Bytes).digest('hex');
  return {
    text,
    canonicalUtf8Bytes,
    hadBom: false,
    provenance: {
      decodingProfileId: LEGACY_FILING_DECODING_PROFILE.profileId,
      decodingProfileFingerprint: LEGACY_FILING_DECODING_PROFILE.fingerprint,
      sourceDeclaredEncoding: inspection.declaredEncoding,
      sourceBomKind: inspection.bomKind,
      sourceUtf8Validity: 'invalid',
      sourceEntrySha256,
      canonicalUtf8Sha256,
      decoderRuntimeLabel: 'node-whatwg-textdecoder:euc-kr',
      compatibilityReason: 'declaration-actual-byte-mismatch',
    },
  };
}

export function filingRepresentationIdentitySeed(
  parserVersion: string,
  provenance: FilingDecodingProvenance | undefined,
): string {
  return provenance == null
    ? parserVersion
    : [
        parserVersion,
        provenance.decodingProfileId,
        provenance.decodingProfileFingerprint,
        provenance.sourceEntrySha256,
        provenance.canonicalUtf8Sha256,
      ].join('\u001f');
}
