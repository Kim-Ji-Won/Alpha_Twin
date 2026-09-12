import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { calculatePersistenceFingerprints } from '../src/filingIntelligence/persistence/fingerprints.js';
import { chunkFilingDocument } from '../src/openDart/document/filingChunker.js';
import {
  decodeValidatedOpenDartMainEntry,
  LEGACY_FILING_DECODING_PROFILE,
  LEGACY_FILING_DECODING_PROFILE_ID,
} from '../src/openDart/document/filingXmlDecoding.js';
import { parseFilingDocument } from '../src/openDart/document/filingXmlParser.js';
import {
  ValidatedDisclosureDocumentArchive,
  ValidatedDisclosureDocumentEntry,
} from '../src/openDart/document/documentContracts.js';
import { OpenDartError, OpenDartErrorCode } from '../src/openDart/errors.js';

const RECEIPT = '20260728000009';
const PREFIX = Buffer.from(
  '<?xml version="1.0" encoding="utf-8"?><DOCUMENT><DOCUMENT-NAME>IDENTITY</DOCUMENT-NAME><BODY><SECTION-1><TITLE>',
  'ascii',
);
const SUFFIX = Buffer.from('</TITLE><P>legacy test</P></SECTION-1></BODY></DOCUMENT>', 'ascii');
// WHATWG euc-kr bytes for the synthetic Korean fixture text. This is not a
// claim about the historical physical charset of an OpenDART filing.
const LEGACY_KOREAN_BYTES = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]);

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function entry(content: Buffer): ValidatedDisclosureDocumentEntry {
  return {
    entryName: `${RECEIPT}.xml`,
    format: 'xml',
    mediaType: 'application/xml',
    compressedSize: content.length,
    uncompressedSize: content.length,
    sha256: sha256(content),
    content,
  };
}

function archive(content: Buffer): ValidatedDisclosureDocumentArchive {
  const selected = entry(content);
  return {
    provider: 'opendart-fss',
    receiptNumber: RECEIPT,
    archiveByteLength: content.length,
    archiveSha256: selected.sha256,
    archiveEntryCount: 1,
    declaredTotalUncompressedBytes: content.length,
    extractedTotalUncompressedBytes: content.length,
    entries: [selected],
  };
}

function authority(content: Buffer) {
  return {
    provider: 'opendart-fss' as const,
    safeArchiveValidated: true as const,
    mainEntrySelected: true as const,
    sourceEntrySha256: sha256(content),
  };
}

function code(expected: OpenDartErrorCode) {
  return (error: unknown): boolean => error instanceof OpenDartError && error.code === expected;
}

function identity(content: Buffer) {
  const document = parseFilingDocument(archive(content));
  const chunks = chunkFilingDocument(document);
  const fingerprints = calculatePersistenceFingerprints({
    metadata: { corpCode: '00164779', symbol: '000660' },
    document,
    chunks,
  });
  return {
    document,
    chunks,
    fingerprints,
    sectionIds: document.sections.map(section => section.sectionId),
    blockIds: document.blocks.map(block => block.blockId),
    chunkIds: chunks.map(chunk => chunk.chunkId),
  };
}

test('legacy decoding profile is immutable and fingerprinted deterministically', () => {
  assert.equal(LEGACY_FILING_DECODING_PROFILE.profileId, LEGACY_FILING_DECODING_PROFILE_ID);
  assert.equal(LEGACY_FILING_DECODING_PROFILE.decoderLabel, 'euc-kr');
  assert.equal(LEGACY_FILING_DECODING_PROFILE.decoderRuntime, 'node-whatwg-textdecoder');
  assert.match(LEGACY_FILING_DECODING_PROFILE.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(
    LEGACY_FILING_DECODING_PROFILE.fingerprint,
    'f8eb663689f2fd985a8941489ae546cb9a3651d3adb9183f32089af23a6f17c0',
  );
  assert.equal(Object.isFrozen(LEGACY_FILING_DECODING_PROFILE), true);
});

test('valid UTF-8 fast path preserves the fixed 1.0.1 identity fixture', () => {
  const content = Buffer.from(
    '<?xml version="1.0" encoding="utf-8"?><DOCUMENT><DOCUMENT-NAME>IDENTITY</DOCUMENT-NAME><BODY><SECTION-1><TITLE>사업</TITLE><P>테스트 문장</P></SECTION-1></BODY></DOCUMENT>',
  );
  const result = identity(content);
  assert.equal(result.document.parserVersion, '1.0.1');
  assert.equal(result.document.source.decoding, undefined);
  assert.deepEqual(result.sectionIds, ['sec_1a8793d39568478e294327c9164fd384']);
  assert.deepEqual(result.blockIds, [
    'blk_c71a470ce0fb7f77d4aa141b5b8cde5f',
    'blk_11febd70c18a7743240f44db48c7aea0',
    'blk_49351de81e3500022755d0a7060da120',
  ]);
  assert.deepEqual(result.chunkIds, [
    'chk_af0d5eaf15e70670cfb56ee773a0d6f6',
    'chk_12d95facb49325f71bc56ca5e4516179',
  ]);
  assert.equal(
    result.fingerprints.canonicalFingerprint,
    'cb25a861d00e73a311607114618f81cba6623f592e1c056bfab800c274b9ef38',
  );
  assert.equal(
    result.fingerprints.chunkFingerprint,
    '46c860671ad0d10f8430260a3a834614b918ad294f670e220db1d755cc0315ce',
  );
});

test('UTF-8 BOM remains on the strict path and never selects the legacy profile', () => {
  const content = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('<?xml version="1.0" encoding="utf-8"?><DOCUMENT><BODY><P>정상</P></BODY></DOCUMENT>'),
  ]);
  const first = identity(content);
  const second = identity(content);
  assert.equal(first.document.source.decoding, undefined);
  assert.deepEqual(first, second);
});

test('OpenDART declaration mismatch selects one fatal legacy compatibility profile', () => {
  const content = Buffer.concat([PREFIX, LEGACY_KOREAN_BYTES, SUFFIX]);
  const decoded = decodeValidatedOpenDartMainEntry(content, authority(content));
  assert.match(decoded.text, /한글/);
  assert.match(decoded.text, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
  assert.equal(decoded.text.includes('\ufffd'), false);
  assert.equal(decoded.provenance?.decodingProfileId, LEGACY_FILING_DECODING_PROFILE_ID);
  assert.equal(decoded.provenance?.sourceEntrySha256, sha256(content));
  assert.equal(decoded.provenance?.canonicalUtf8Sha256, sha256(decoded.canonicalUtf8Bytes));
  assert.notEqual(decoded.provenance?.sourceEntrySha256, decoded.provenance?.canonicalUtf8Sha256);
  assert.equal(
    decoded.provenance?.sourceEntrySha256,
    'ba66474e30b22732f39895250471fc777374a63159fe91f509c7617f59df3c91',
  );
  assert.equal(
    decoded.provenance?.canonicalUtf8Sha256,
    'b799176d4035731bea5058e3ad6ca47a170e7e6fafa66d78eb35f35f5b12367b',
  );
});

test('legacy canonical, chunk, and representation identities are deterministic and isolated', () => {
  const content = Buffer.concat([PREFIX, LEGACY_KOREAN_BYTES, SUFFIX]);
  const first = identity(content);
  const second = identity(content);
  assert.deepEqual(first, second);
  assert.equal(first.document.parserVersion, '1.0.1');
  assert.equal(first.document.source.decoding?.decodingProfileId, LEGACY_FILING_DECODING_PROFILE_ID);
  const validUtf8 = Buffer.concat([PREFIX, Buffer.from('한글'), SUFFIX]);
  const utf8 = identity(validUtf8);
  assert.notDeepEqual(first.blockIds, utf8.blockIds);
  assert.notDeepEqual(first.chunkIds, utf8.chunkIds);
  assert.notEqual(
    first.fingerprints.canonicalFingerprint,
    utf8.fingerprints.canonicalFingerprint,
  );
  assert.notEqual(first.fingerprints.chunkFingerprint, utf8.fingerprints.chunkFingerprint);
});

test('legacy-only OpenDART CR entities and Korean angle labels are normalized deterministically', () => {
  const content = Buffer.concat([
    Buffer.from(
      '<?xml version="1.0" encoding="utf-8"?><DOCUMENT><BODY><P>',
      'ascii',
    ),
    LEGACY_KOREAN_BYTES,
    Buffer.from('&cr;&lt;safe&gt;<', 'ascii'),
    Buffer.from([0xbb, 0xe8, 0xc1, 0xa6]),
    Buffer.from('1999.4.9></P></BODY></DOCUMENT>', 'ascii'),
  ]);
  const first = identity(content);
  const second = identity(content);
  assert.deepEqual(first, second);
  assert.equal(first.document.source.compatibility?.repairs.carriageReturnEntityCount, 1);
  assert.equal(first.document.source.compatibility?.repairs.literalAngleBracketCount, 1);

  const utf8 = Buffer.from(
    '<?xml version="1.0" encoding="utf-8"?><DOCUMENT><BODY><P>한글&cr;</P></BODY></DOCUMENT>',
  );
  assert.throws(
    () => parseFilingDocument(archive(utf8)),
    code('OPENDART_DOCUMENT_MALFORMED_XML'),
  );
});

test('legacy compatibility trigger fails closed outside its exact declaration and BOM contract', () => {
  const invalid = Buffer.from([0xff]);
  const cases: readonly Buffer[] = [
    Buffer.concat([Buffer.from('<DOCUMENT><P>'), invalid, Buffer.from('</P></DOCUMENT>')]),
    Buffer.concat([Buffer.from('<?xml version="1.0" encoding="euc-kr"?><DOCUMENT><P>'), invalid, Buffer.from('</P></DOCUMENT>')]),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), PREFIX, invalid, SUFFIX]),
    Buffer.from([0xff, 0xfe, 0x3c, 0x00, 0x52, 0x00, 0x2f, 0x00, 0x3e, 0x00]),
  ];
  assert.throws(
    () => decodeValidatedOpenDartMainEntry(cases[0]!, authority(cases[0]!)),
    code('OPENDART_DOCUMENT_LEGACY_ENCODING_NOT_ELIGIBLE'),
  );
  assert.throws(
    () => decodeValidatedOpenDartMainEntry(cases[1]!, authority(cases[1]!)),
    code('OPENDART_DOCUMENT_UNSUPPORTED_XML_ENCODING'),
  );
  assert.throws(
    () => decodeValidatedOpenDartMainEntry(cases[2]!, authority(cases[2]!)),
    code('OPENDART_DOCUMENT_LEGACY_ENCODING_NOT_ELIGIBLE'),
  );
  assert.throws(
    () => decodeValidatedOpenDartMainEntry(cases[3]!, authority(cases[3]!)),
    code('OPENDART_DOCUMENT_UNSUPPORTED_XML_ENCODING'),
  );
});

test('invalid legacy sequences and legacy-decoded unsafe XML are rejected without content leakage', () => {
  const invalid = Buffer.concat([PREFIX, Buffer.from([0xff]), SUFFIX]);
  assert.throws(
    () => decodeValidatedOpenDartMainEntry(invalid, authority(invalid)),
    (error: unknown) => {
      assert.ok(error instanceof OpenDartError);
      assert.equal(error.code, 'OPENDART_DOCUMENT_LEGACY_DECODE_FAILED');
      assert.equal(error.message.includes(invalid.toString('hex')), false);
      return true;
    },
  );
  const unsafe = Buffer.concat([
    Buffer.from('<?xml version="1.0" encoding="utf-8"?><!DOCTYPE DOCUMENT><DOCUMENT><P>'),
    LEGACY_KOREAN_BYTES,
    Buffer.from('</P></DOCUMENT>'),
  ]);
  assert.throws(
    () => decodeValidatedOpenDartMainEntry(unsafe, authority(unsafe)),
    code('OPENDART_DOCUMENT_LEGACY_XML_SAFETY_FAILED'),
  );
  const invalidXmlCharacter = Buffer.concat([
    Buffer.from('<?xml version="1.0" encoding="utf-8"?><DOCUMENT><P>'),
    LEGACY_KOREAN_BYTES,
    Buffer.from([0x01]),
    Buffer.from('</P></DOCUMENT>'),
  ]);
  assert.throws(
    () => decodeValidatedOpenDartMainEntry(
      invalidXmlCharacter,
      authority(invalidXmlCharacter),
    ),
    code('OPENDART_DOCUMENT_LEGACY_XML_SAFETY_FAILED'),
  );
});

test('provenance authority rejects a raw source hash mismatch', () => {
  const content = Buffer.concat([PREFIX, LEGACY_KOREAN_BYTES, SUFFIX]);
  assert.throws(
    () => decodeValidatedOpenDartMainEntry(content, {
      ...authority(content),
      sourceEntrySha256: '0'.repeat(64),
    }),
    code('OPENDART_DOCUMENT_PROVENANCE_MISMATCH'),
  );
});
