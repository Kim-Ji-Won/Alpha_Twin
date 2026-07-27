import assert from 'node:assert/strict';
import test from 'node:test';

import { SafeDisclosureArchiveReader } from '../src/openDart/document/safeDisclosureArchiveReader.js';
import {
  DEFAULT_DISCLOSURE_ARCHIVE_POLICY,
  DisclosureArchivePolicy,
} from '../src/openDart/document/documentPolicy.js';
import { OpenDartError } from '../src/openDart/errors.js';
import { syntheticZip } from './helpers/syntheticZip.js';

const receipt = '20260720000001';
const xml = '<DOCUMENT><TITLE>ALPHA TWIN TEST COMPANY</TITLE></DOCUMENT>';
const defaultTestPolicy: DisclosureArchivePolicy = {
  maximumCompressedBytes: 8 * 1024,
  maximumTotalUncompressedBytes: 4 * 1024,
  maximumEntryUncompressedBytes: 2 * 1024,
  maximumEntries: 8,
  maximumFileNameBytes: 255,
};

function reader(overrides: Partial<DisclosureArchivePolicy> = {}) {
  return new SafeDisclosureArchiveReader({ ...defaultTestPolicy, ...overrides });
}

test('production archive policy keeps the audited secure defaults', () => {
  assert.deepEqual(DEFAULT_DISCLOSURE_ARCHIVE_POLICY, {
    maximumCompressedBytes: 20 * 1024 * 1024,
    maximumTotalUncompressedBytes: 64 * 1024 * 1024,
    maximumEntryUncompressedBytes: 32 * 1024 * 1024,
    maximumEntries: 64,
    maximumFileNameBytes: 255,
  });
});

async function rejectsWith(
  archive: Buffer,
  code: OpenDartError['code'],
  customReader = reader(),
) {
  await assert.rejects(
    customReader.read(receipt, archive),
    (error: OpenDartError) => error.code === code,
  );
}

test('safe archive reader returns bounded XML bytes and stable provenance hashes', async () => {
  const archive = syntheticZip([
    { name: 'directory/', unixMode: 0o040755 },
    { name: 'directory/first.XML', content: xml, compression: 'deflate' },
    { name: 'second.xml', content: '\ufeff \n<?xml version="1.0"?><ROOT>two</ROOT>' },
    { name: 'ignored.txt', content: 'not parser input' },
  ]);
  const result = await reader().read(receipt, archive);
  assert.equal(result.provider, 'opendart-fss');
  assert.equal(result.receiptNumber, receipt);
  assert.equal(result.archiveEntryCount, 4);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0]?.entryName, 'directory/first.XML');
  assert.equal(result.entries[0]?.mediaType, 'application/xml');
  assert.equal(result.entries[0]?.content.toString(), xml);
  assert.match(result.archiveSha256, /^[a-f0-9]{64}$/);
  assert.match(result.entries[0]?.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(
    result.extractedTotalUncompressedBytes,
    result.entries.reduce((sum, entry) => sum + entry.content.length, 0),
  );
});

test('safe archive reader rejects Zip Slip, absolute, Windows, encoded, and NUL paths', async () => {
  for (const name of [
    '../evil.xml',
    '../../evil.xml',
    '/absolute.xml',
    '\\absolute.xml',
    'C:\\evil.xml',
    'safe/../../evil.xml',
    '%2e%2e/evil.xml',
    '\uff0e\uff0e/evil.xml',
    'bad\0name.xml',
  ]) {
    await rejectsWith(
      syntheticZip([{ name, content: xml }]),
      'OPENDART_DOCUMENT_UNSAFE_ARCHIVE',
    );
  }
});

test('safe archive reader rejects normalized duplicate names and oversized filenames', async () => {
  await rejectsWith(syntheticZip([
    { name: 'Document.xml', content: xml },
    { name: 'document.xml', content: xml },
  ]), 'OPENDART_DOCUMENT_UNSAFE_ARCHIVE');
  await rejectsWith(
    syntheticZip([{ name: `${'a'.repeat(256)}.xml`, content: xml }]),
    'OPENDART_DOCUMENT_UNSAFE_ARCHIVE',
  );
});

test('safe archive reader rejects encrypted, symlink, and special file entries', async () => {
  await rejectsWith(
    syntheticZip([{ name: 'encrypted.xml', content: xml, encrypted: true }]),
    'OPENDART_DOCUMENT_UNSAFE_ARCHIVE',
  );
  await rejectsWith(
    syntheticZip([{ name: 'link.xml', content: xml, unixMode: 0o120777 }]),
    'OPENDART_DOCUMENT_UNSAFE_ARCHIVE',
  );
  await rejectsWith(
    syntheticZip([{ name: 'device.xml', content: xml, unixMode: 0o020666 }]),
    'OPENDART_DOCUMENT_UNSAFE_ARCHIVE',
  );
});

test('safe archive reader rejects named and disguised nested archives', async () => {
  await rejectsWith(
    syntheticZip([{ name: 'nested.zip', content: syntheticZip([{ name: 'x.xml', content: xml }]) }]),
    'OPENDART_DOCUMENT_UNSAFE_ARCHIVE',
  );
  await rejectsWith(
    syntheticZip([{ name: 'disguised.xml', content: syntheticZip([{ name: 'x.xml', content: xml }]) }]),
    'OPENDART_DOCUMENT_UNSAFE_ARCHIVE',
  );
});

test('safe archive reader enforces compressed, entry, single, and total limits', async () => {
  const one = { name: 'one.xml', content: `<ROOT>${'x'.repeat(80)}</ROOT>` };
  await rejectsWith(
    syntheticZip([one]),
    'OPENDART_DOCUMENT_TOO_LARGE',
    reader({ maximumCompressedBytes: 10 }),
  );
  await rejectsWith(
    syntheticZip([one]),
    'OPENDART_DOCUMENT_TOO_LARGE',
    reader({ maximumEntryUncompressedBytes: 40 }),
  );
  await rejectsWith(
    syntheticZip([one, { name: 'two.xml', content: one.content }]),
    'OPENDART_DOCUMENT_TOO_LARGE',
    reader({
      maximumEntryUncompressedBytes: 120,
      maximumTotalUncompressedBytes: 120,
    }),
  );
  await rejectsWith(
    syntheticZip([one, { name: 'two.xml', content: one.content }]),
    'OPENDART_DOCUMENT_TOO_LARGE',
    reader({ maximumEntries: 1 }),
  );
});

test('safe archive reader rejects malformed archives and archives without XML candidates', async () => {
  await rejectsWith(
    Buffer.from('PK\x03\x04damaged'),
    'OPENDART_DOCUMENT_INVALID_ARCHIVE',
  );
  await rejectsWith(
    syntheticZip([{ name: 'notes.txt', content: 'synthetic test' }]),
    'OPENDART_DOCUMENT_NO_ELIGIBLE_ENTRY',
  );
  await rejectsWith(
    syntheticZip([{ name: 'fake.xml', content: 'plain text' }]),
    'OPENDART_DOCUMENT_INVALID_ARCHIVE',
  );
});
