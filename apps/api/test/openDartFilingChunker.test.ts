import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  ValidatedDisclosureDocumentArchive,
  ValidatedDisclosureDocumentEntry,
} from '../src/openDart/document/documentContracts.js';
import { chunkFilingDocument } from '../src/openDart/document/filingChunker.js';
import { parseFilingDocument } from '../src/openDart/document/filingXmlParser.js';
import { OpenDartError } from '../src/openDart/errors.js';

const RECEIPT = '20260728000002';

function archiveFor(body: string): ValidatedDisclosureDocumentArchive {
  const content = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
    <DOCUMENT><DOCUMENT-NAME>ALPHA TWIN TEST REPORT</DOCUMENT-NAME><BODY>${body}</BODY></DOCUMENT>`);
  const entry: ValidatedDisclosureDocumentEntry = {
    entryName: `${RECEIPT}.xml`,
    format: 'xml',
    mediaType: 'application/xml',
    compressedSize: content.length,
    uncompressedSize: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
    content,
  };
  return {
    provider: 'opendart-fss',
    receiptNumber: RECEIPT,
    archiveByteLength: content.length,
    archiveSha256: entry.sha256,
    archiveEntryCount: 1,
    declaredTotalUncompressedBytes: content.length,
    extractedTotalUncompressedBytes: content.length,
    entries: [entry],
  };
}

test('small same-section blocks group into one deterministic chunk', () => {
  const document = parseFilingDocument(
    archiveFor('<SECTION-1><TITLE>사업</TITLE><P>첫 문단</P><P>둘째 문단</P></SECTION-1>'),
    { upstreamReportName: '분기보고서' },
  );
  const first = chunkFilingDocument(document);
  const second = chunkFilingDocument(document);
  assert.equal(first.length, 2);
  assert.deepEqual(first, second);
  const sectionChunk = first[1]!;
  assert.match(sectionChunk.sourceText, /사업\n\n첫 문단\n\n둘째 문단/);
  assert.match(sectionChunk.retrievalText, /^\[분기보고서\]\n\[사업\]/);
  assert.equal(sectionChunk.sourceText.startsWith('[분기보고서]'), false);
  assert.equal(sectionChunk.charCount, sectionChunk.retrievalText.length);
});

test('chunker never groups content across section boundaries', () => {
  const document = parseFilingDocument(archiveFor(`
    <SECTION-1><TITLE>A</TITLE><P>alpha</P></SECTION-1>
    <SECTION-1><TITLE>B</TITLE><P>beta</P></SECTION-1>`));
  const chunks = chunkFilingDocument(document);
  const sectionChunks = chunks.filter(chunk => chunk.sectionId != null);
  assert.equal(sectionChunks.length, 2);
  assert.deepEqual(sectionChunks.map(chunk => chunk.sectionPath), [['A'], ['B']]);
});

test('oversized paragraphs use bounded deterministic fallback splits without empties', () => {
  const paragraph = Array.from({ length: 80 }, (_, index) => `문장${index} 데이터입니다.`).join(' ');
  const document = parseFilingDocument(
    archiveFor(`<SECTION-1><TITLE>장문</TITLE><P>${paragraph}</P></SECTION-1>`),
  );
  const chunks = chunkFilingDocument(document, { maximumChars: 220, maximumChunks: 100 });
  const paragraphChunks = chunks.filter(chunk => chunk.sourceText.includes('문장'));
  assert.ok(paragraphChunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.charCount <= 220 && chunk.sourceText.length > 0));
  assert.ok(paragraphChunks.slice(1).every(chunk => chunk.locator.continuation === true));
});

test('large tables split by row groups and repeat header context', () => {
  const rows = Array.from(
    { length: 18 },
    (_, index) => `<TR><TD>항목 ${index}</TD><TD>${'값'.repeat(24)}</TD></TR>`,
  ).join('');
  const document = parseFilingDocument(archiveFor(`
    <SECTION-1><TITLE>표 섹션</TITLE>
      <TABLE-GROUP><TITLE>대형 표</TITLE><P>(단위: 백만원)</P><TABLE>
        <THEAD><TR><TH>항목</TH><TH>금액</TH></TR></THEAD>
        <TBODY>${rows}</TBODY>
      </TABLE></TABLE-GROUP>
    </SECTION-1>`));
  const chunks = chunkFilingDocument(document, { maximumChars: 260, maximumChunks: 100 });
  const tableChunks = chunks.filter(chunk => chunk.locator.tableId);
  assert.ok(tableChunks.length > 1);
  assert.ok(tableChunks.every(chunk => chunk.sourceText.includes('대형 표')));
  assert.ok(tableChunks.every(chunk => chunk.sourceText.includes('항목 | 금액')));
  assert.ok(tableChunks.every(chunk => chunk.locator.rowRange != null));
  assert.ok(tableChunks.every(chunk =>
    chunk.locator.repeatedHeaderRowRange?.[0] === 0
    && chunk.locator.repeatedHeaderRowRange[1] === 0));
  assert.ok(tableChunks.every(chunk => chunk.charCount <= 260));
});

test('oversized single table cells remain bounded and carry continuation metadata', () => {
  const document = parseFilingDocument(archiveFor(`
    <SECTION-1><TITLE>표</TITLE><TABLE>
      <THEAD><TR><TH>설명</TH></TR></THEAD>
      <TBODY><TR><TD>${'매우 긴 셀 내용입니다. '.repeat(80)}</TD></TR></TBODY>
    </TABLE></SECTION-1>`));
  const chunks = chunkFilingDocument(document, { maximumChars: 200, maximumChunks: 100 });
  const tableChunks = chunks.filter(chunk => chunk.locator.tableId);
  assert.ok(tableChunks.length > 1);
  assert.ok(tableChunks.every(chunk => chunk.charCount <= 200));
  assert.ok(tableChunks.slice(1).some(chunk => chunk.locator.continuation === true));
  assert.ok(tableChunks.every(chunk => chunk.locator.rowRange?.[0] === 1));
  assert.deepEqual(
    tableChunks.map(chunk => chunk.locator.continuationIndex),
    tableChunks.map((_, index) => index),
  );
  assert.equal(
    new Set(tableChunks.map(chunk => JSON.stringify(chunk.locator))).size,
    tableChunks.length,
  );
});

test('chunk IDs and content hashes are stable while repeated source locations remain distinct', () => {
  const document = parseFilingDocument(archiveFor(`
    <SECTION-1><TITLE>A</TITLE><P>반복 내용</P></SECTION-1>
    <SECTION-1><TITLE>B</TITLE><P>반복 내용</P></SECTION-1>`));
  const chunks = chunkFilingDocument(document);
  assert.equal(new Set(chunks.map(chunk => chunk.chunkId)).size, chunks.length);
  assert.deepEqual(chunks.map(chunk => chunk.ordinal), chunks.map((_, index) => index));
  const repeated = document.blocks.filter(block => block.sourceText === '반복 내용');
  assert.equal(repeated.length, 2);
  assert.notEqual(repeated[0]?.blockId, repeated[1]?.blockId);
});

test('all retrieval-eligible canonical blocks are represented in chunk provenance', () => {
  const document = parseFilingDocument(archiveFor(`
    <SECTION-1><TITLE>A</TITLE><P>alpha</P><TABLE>
      <TR><TH>key</TH><TH>value</TH></TR><TR><TD>x</TD><TD>1,000</TD></TR>
    </TABLE><P>omega</P></SECTION-1>`));
  const chunks = chunkFilingDocument(document);
  const covered = new Set(chunks.flatMap(chunk => chunk.sourceBlockIds));
  assert.deepEqual(
    document.blocks.map(block => block.blockId).filter(id => covered.has(id)),
    document.blocks.map(block => block.blockId),
  );
});

test('chunk explosion guard returns a typed failure', () => {
  const document = parseFilingDocument(archiveFor(`
    <SECTION-1><TITLE>A</TITLE><P>${'데이터 '.repeat(200)}</P></SECTION-1>`));
  assert.throws(
    () => chunkFilingDocument(document, { maximumChars: 128, maximumChunks: 1 }),
    (error: unknown) =>
      error instanceof OpenDartError && error.code === 'OPENDART_DOCUMENT_CHUNKING_FAILED',
  );
});
