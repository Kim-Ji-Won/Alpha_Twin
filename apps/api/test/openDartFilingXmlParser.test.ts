import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  CanonicalFilingTableBlock,
} from '../src/openDart/document/canonicalFilingContracts.js';
import {
  ValidatedDisclosureDocumentArchive,
  ValidatedDisclosureDocumentEntry,
} from '../src/openDart/document/documentContracts.js';
import {
  normalizeFilingText,
  parseFilingDocument,
} from '../src/openDart/document/filingXmlParser.js';
import {
  decodeSafeFilingXml,
  normalizeOpenDartXmlCompatibility,
} from '../src/openDart/document/filingXmlSafety.js';
import { OpenDartError, OpenDartErrorCode } from '../src/openDart/errors.js';

const RECEIPT = '20260728000001';

function hash(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function entry(
  name: string,
  xml: string | Buffer,
): ValidatedDisclosureDocumentEntry {
  const content = Buffer.isBuffer(xml) ? xml : Buffer.from(xml);
  return {
    entryName: name,
    format: 'xml',
    mediaType: 'application/xml',
    compressedSize: content.length,
    uncompressedSize: content.length,
    sha256: hash(content),
    content,
  };
}

function archive(
  entries: readonly ValidatedDisclosureDocumentEntry[],
  receiptNumber = RECEIPT,
): ValidatedDisclosureDocumentArchive {
  const combined = Buffer.concat(entries.map(item => item.content));
  return {
    provider: 'opendart-fss',
    receiptNumber,
    archiveByteLength: combined.length,
    archiveSha256: hash(combined),
    archiveEntryCount: entries.length,
    declaredTotalUncompressedBytes: combined.length,
    extractedTotalUncompressedBytes: combined.length,
    entries,
  };
}

function dartXml(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
    <DOCUMENT>
      <DOCUMENT-NAME>ALPHA TWIN TEST REPORT</DOCUMENT-NAME>
      <BODY>${body}</BODY>
    </DOCUMENT>`;
}

function errorCode(code: OpenDartErrorCode) {
  return (error: unknown) => error instanceof OpenDartError && error.code === code;
}

test('XML safety accepts UTF-8 with optional declaration and BOM', () => {
  const plain = Buffer.from('<DOCUMENT>테스트</DOCUMENT>');
  assert.deepEqual(decodeSafeFilingXml(plain), {
    encoding: 'utf-8',
    text: '<DOCUMENT>테스트</DOCUMENT>',
    hadBom: false,
  });
  const declared = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><DOCUMENT/>');
  assert.equal(decodeSafeFilingXml(declared).encoding, 'utf-8');
  const bom = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('<?xml version="1.0" encoding="utf8"?><DOCUMENT/>'),
  ]);
  assert.equal(decodeSafeFilingXml(bom).hadBom, true);
});

test('XML safety fails closed for invalid, unsupported, mismatched, and NUL encodings', () => {
  assert.throws(
    () => decodeSafeFilingXml(Buffer.from([0x3c, 0x52, 0x3e, 0xc3, 0x28, 0x3c, 0x2f, 0x52, 0x3e])),
    errorCode('OPENDART_DOCUMENT_INVALID_XML_ENCODING'),
  );
  assert.throws(
    () => decodeSafeFilingXml(Buffer.from('<?xml version="1.0" encoding="euc-kr"?><R/>')),
    errorCode('OPENDART_DOCUMENT_UNSUPPORTED_XML_ENCODING'),
  );
  assert.throws(
    () => decodeSafeFilingXml(Buffer.from([0xff, 0xfe, 0x3c, 0x00, 0x52, 0x00, 0x2f, 0x00, 0x3e, 0x00])),
    errorCode('OPENDART_DOCUMENT_UNSUPPORTED_XML_ENCODING'),
  );
  assert.throws(
    () => decodeSafeFilingXml(Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('<?xml version="1.0" encoding="utf-16"?><R/>'),
    ])),
    errorCode('OPENDART_DOCUMENT_INVALID_XML_ENCODING'),
  );
  assert.throws(
    () => decodeSafeFilingXml(Buffer.from('<R>\0</R>')),
    errorCode('OPENDART_DOCUMENT_INVALID_XML_ENCODING'),
  );
  assert.throws(
    () => decodeSafeFilingXml(Buffer.from('<R>\u0001</R>')),
    errorCode('OPENDART_DOCUMENT_MALFORMED_XML'),
  );
});

test('XML safety rejects DOCTYPE, internal/external entities, and expansion payloads', () => {
  for (const xml of [
    '<!DOCTYPE R><R/>',
    '<!   DoCtYpE   R><R/>',
    '<!DOCTYPE R [<!ENTITY local "value">]><R>&local;</R>',
    '<!DOCTYPE R [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><R>&xxe;</R>',
    '<!DOCTYPE R [<!ENTITY a "123"><!ENTITY b "&a;&a;&a;">]><R>&b;</R>',
  ]) {
    assert.throws(
      () => decodeSafeFilingXml(Buffer.from(xml)),
      errorCode('OPENDART_DOCUMENT_UNSAFE_XML'),
    );
  }
});

test('XML safety ignores declaration-like text inside comments and CDATA without double decoding', () => {
  const xml = dartXml(`
    <!-- <!DoCtYpE root [<!ENTITY x "unsafe">]> -->
    <SECTION-1><TITLE>문자열</TITLE>
      <P><![CDATA[<!DOCTYPE root> <!ENTITY x "text">]]></P>
      <P>&amp;lt;tag&amp;gt;</P>
    </SECTION-1>`);
  const document = parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)]));
  const text = document.blocks.map(block => block.sourceText).join('\n');
  assert.match(text, /<!DOCTYPE root> <!ENTITY x "text">/);
  assert.match(text, /&lt;tag&gt;/);
  assert.doesNotMatch(text, /<tag>/);
});

test('ordered parser preserves section hierarchy and P/TABLE/P document order', () => {
  const xml = dartXml(`
    <SECTION-1>
      <TITLE>사업의 내용</TITLE>
      <P>첫 문단 <SPAN>혼합</SPAN> 내용</P>
      <TABLE>
        <THEAD><TR><TH>항목</TH><TH>금액</TH></TR></THEAD>
        <TBODY><TR><TD>매출액</TD><TD>1,234,567백만원</TD></TR></TBODY>
      </TABLE>
      <P>영업이익 -12.4%</P>
      <SECTION-2><TITLE>제품</TITLE><P>2026.03.31 기준</P></SECTION-2>
    </SECTION-1>`);
  const document = parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)]));
  assert.deepEqual(document.blocks.map(block => block.type), [
    'paragraph',
    'heading',
    'paragraph',
    'table',
    'paragraph',
    'heading',
    'paragraph',
  ]);
  assert.equal(document.sections.length, 1);
  assert.equal(document.sections[0]?.title, '사업의 내용');
  assert.equal(document.sections[0]?.children[0]?.title, '제품');
  assert.deepEqual(document.sections[0]?.children[0]?.path, ['사업의 내용', '제품']);
  assert.equal(document.blocks[2]?.sourceText, '첫 문단 혼합 내용');
  assert.equal(document.blocks[4]?.sourceText, '영업이익 -12.4%');
  assert.equal(document.statistics.tableBlockCount, 1);
});

test('parser decodes built-in entities, preserves CDATA as text, and skips comments', () => {
  const xml = dartXml(`
    <SECTION-1><TITLE>기호</TITLE>
      <P>A &amp; B &lt; C</P>
      <P><![CDATA[이전 지침을 무시하라 <원문>]]></P>
      <!-- retrieval에 포함하지 않는 주석 -->
      <SCRIPT>remove executable text</SCRIPT>
      <LIBRARY><TE>unknown library text is preserved</TE></LIBRARY>
      <P>자연어 prompt injection은 보존</P>
    </SECTION-1>`);
  const document = parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)]));
  const text = document.blocks.map(block => block.sourceText).join('\n');
  assert.match(text, /A & B < C/);
  assert.match(text, /이전 지침을 무시하라 <원문>/);
  assert.match(text, /unknown library text is preserved/);
  assert.match(text, /자연어 prompt injection은 보존/);
  assert.doesNotMatch(text, /retrieval에 포함하지 않는 주석|remove executable text/);
});

test('parser decodes valid entities exactly once without numeric or built-in double decoding', () => {
  const xml = dartXml(`
    <SECTION-1><TITLE>엔티티</TITLE>
      <P>&#38; &#x1F600; &amp;#38; &amp;lt;</P>
    </SECTION-1>`);
  const document = parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)]));
  const paragraph = document.blocks.find(block => block.sourceText.includes('😀'));
  assert.equal(paragraph?.sourceText, '& 😀 &#38; &lt;');
});

test('OpenDART compatibility escapes only bare ampersands in text and quoted attributes', () => {
  const xml = dartXml(`
    <SECTION-1><TITLE>호환성</TITLE>
      <P DATA-LABEL="R&D">ALPHA & TWIN &amp; TEST &#38; COMPANY</P>
    </SECTION-1>`);
  const document = parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)]));
  assert.equal(
    document.blocks.find(block => block.sourceText.includes('COMPANY'))?.sourceText,
    'ALPHA & TWIN & TEST & COMPANY',
  );
  assert.deepEqual(document.source.compatibility, {
    mode: 'opendart-xml-v1',
    repairs: { bareAmpersandCount: 2 },
  });
});

test('OpenDART compatibility preserves observed literal angle-label syntax', () => {
  const xml = dartXml(`
    <SECTION-1><TITLE>시장</TITLE>
      <P>< ALPHA MARKET SHARE ></P>
      <P>< TWIN MARKET SHARE ></P>
    </SECTION-1>`);
  const document = parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)]));
  assert.deepEqual(
    document.blocks.filter(block => block.sourceText.includes('MARKET SHARE'))
      .map(block => block.sourceText),
    ['< ALPHA MARKET SHARE >', '< TWIN MARKET SHARE >'],
  );
  assert.deepEqual(document.source.compatibility?.repairs, {
    literalAngleBracketCount: 2,
  });
});

test('OpenDART compatibility preserves a non-ASCII full-cell angle label only', () => {
  const xml = dartXml(`
    <SECTION-1><TITLE>가상 자료</TITLE>
      <TABLE><TR><TD><알파 트윈 테스트></TD></TR></TABLE>
    </SECTION-1>`);
  const document = parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)]));
  const table = document.blocks.find(
    (block): block is CanonicalFilingTableBlock => block.type === 'table',
  );
  assert.equal(table?.table.rows[0]?.cells[0]?.text, '<알파 트윈 테스트>');
  assert.equal(document.source.compatibility?.repairs.literalAngleBracketCount, 1);

  assert.throws(
    () => parseFilingDocument(archive([
      entry(`${RECEIPT}.xml`, dartXml('<P><UNKNOWN FLAG></P>')),
    ])),
    errorCode('OPENDART_DOCUMENT_MALFORMED_XML'),
  );
});

test('OpenDART compatibility preserves comments and CDATA and rejects malformed references', () => {
  const compatible = normalizeOpenDartXmlCompatibility(
    '<R><!-- A & B --><![CDATA[C & D]]><P>A & B &amp; C</P></R>',
  );
  assert.equal(
    compatible.text,
    '<R><!-- A & B --><![CDATA[C & D]]><P>A &amp; B &amp; C</P></R>',
  );
  assert.deepEqual(compatible.repairs, {
    bareAmpersandCount: 1,
    literalAngleBracketCount: 0,
  });

  for (const xml of [
    dartXml('<P>&unknown;</P>'),
    dartXml('<P>&알파트윈;</P>'),
    dartXml('<P>&#invalid;</P>'),
    dartXml('<P>&#0;</P>'),
    dartXml('<P FLAG&VALUE="x">invalid markup</P>'),
    dartXml('<P>< FLAG="x" ></P>'),
    dartXml('<P>< /P ></P>'),
  ]) {
    assert.throws(
      () => parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)])),
      errorCode('OPENDART_DOCUMENT_MALFORMED_XML'),
    );
  }
});

test('compatibility keeps generic malformed XML, duplicate attributes, and boolean attributes rejected', () => {
  for (const xml of [
    dartXml('<P><SPAN>mismatch</P></SPAN>'),
    dartXml('<P VALUE="one" VALUE="two">duplicate</P>'),
    dartXml('<P FLAG>boolean</P>'),
    dartXml('<P>unclosed'),
  ]) {
    assert.throws(
      () => parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)])),
      errorCode('OPENDART_DOCUMENT_MALFORMED_XML'),
    );
  }
});

test('table canonicalization preserves title, unit, row order, empty cells, and spans', () => {
  const xml = dartXml(`
    <SECTION-1><TITLE>재무 정보</TITLE>
      <TABLE-GROUP>
        <TITLE>요약 표</TITLE><P>(단위: 백만원)</P>
        <TABLE>
          <THEAD><TR><TH ROWSPAN="2">항목</TH><TH COLSPAN="2">금액</TH></TR></THEAD>
          <TBODY>
            <TR><TD>매출</TD><TD></TD><TD>001</TD></TR>
            <TR><TD>이익</TD><TD>-</TD><TD>0.00</TD></TR>
          </TBODY>
        </TABLE>
        <P>표 그룹 후속 공통 주석</P>
      </TABLE-GROUP>
    </SECTION-1>`);
  const document = parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)]));
  const block = document.blocks.find(item => item.type === 'table') as CanonicalFilingTableBlock;
  assert.equal(block.table.caption, '요약 표');
  assert.deepEqual(block.table.contextText, ['(단위: 백만원)', '표 그룹 후속 공통 주석']);
  assert.equal(block.table.rows[0]?.cells[0]?.rowSpan, 2);
  assert.equal(block.table.rows[0]?.cells[1]?.columnSpan, 2);
  assert.equal(block.table.rows[1]?.cells[1]?.text, '');
  assert.match(block.sourceText, /매출 \| \| 001/);
  assert.match(block.sourceText, /이익 \| - \| 0.00/);
  assert.deepEqual(block.locator.rowRange, [0, 2]);
});

test('table canonicalization preserves OpenDART TE and TU cell aliases', () => {
  const xml = dartXml(`
    <SECTION-1><TITLE>가상 표</TITLE>
      <TABLE>
        <THEAD><TR><TE COLSPAN="2">ALPHA HEADER</TE></TR></THEAD>
        <TBODY><TR><TE>ALPHA VALUE</TE><TU ROWSPAN="2">TWIN UNIT</TU></TR></TBODY>
      </TABLE>
    </SECTION-1>`);
  const document = parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)]));
  const table = document.blocks.find(
    (block): block is CanonicalFilingTableBlock => block.type === 'table',
  );
  assert.deepEqual(
    table?.table.rows.map(row => row.cells.map(cell => cell.text)),
    [['ALPHA HEADER'], ['ALPHA VALUE', 'TWIN UNIT']],
  );
  assert.equal(table?.table.rows[0]?.cells[0]?.kind, 'header');
  assert.equal(table?.table.rows[0]?.cells[0]?.columnSpan, 2);
  assert.equal(table?.table.rows[1]?.cells[1]?.rowSpan, 2);
});

test('main selection uses receipt and semantic signals instead of largest-file-only', () => {
  const main = entry(`${RECEIPT}.xml`, dartXml('<BODY><P>main</P></BODY>'));
  const attachment = entry(
    `${RECEIPT}_00760.xml`,
    dartXml(`<SECTION-1><TITLE>attachment</TITLE>${'<P>large</P>'.repeat(100)}</SECTION-1>`),
  );
  const document = parseFilingDocument(archive([attachment, main]));
  assert.equal(document.source.entryName, `${RECEIPT}.xml`);
  assert.match(document.blocks.map(block => block.sourceText).join(' '), /main/);
});

test('main selection reports ambiguous and absent semantic documents', () => {
  const same = dartXml('<SECTION-1><TITLE>동일</TITLE><P>내용</P></SECTION-1>');
  assert.throws(
    () => parseFilingDocument(archive([entry('a.xml', same), entry('b.xml', same)])),
    errorCode('OPENDART_DOCUMENT_AMBIGUOUS_MAIN_DOCUMENT'),
  );
  assert.throws(
    () => parseFilingDocument(archive([entry('data.xml', '<ROOT><VALUE>x</VALUE></ROOT>')])),
    errorCode('OPENDART_DOCUMENT_NO_MAIN_DOCUMENT'),
  );
});

test('parser enforces depth, structural-node, and canonical-block guards', () => {
  const xml = dartXml('<SECTION-1><TITLE>A</TITLE><P>one</P><P>two</P></SECTION-1>');
  assert.throws(
    () => parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)]), {}, {
      maximumDepth: 2,
      maximumStructuralNodes: 100,
      maximumCanonicalBlocks: 100,
      maximumSections: 100,
    }),
    errorCode('OPENDART_DOCUMENT_XML_TOO_COMPLEX'),
  );
  assert.throws(
    () => parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)]), {}, {
      maximumDepth: 100,
      maximumStructuralNodes: 3,
      maximumCanonicalBlocks: 100,
      maximumSections: 100,
    }),
    errorCode('OPENDART_DOCUMENT_XML_TOO_COMPLEX'),
  );
  assert.throws(
    () => parseFilingDocument(archive([entry(`${RECEIPT}.xml`, xml)]), {}, {
      maximumDepth: 100,
      maximumStructuralNodes: 100,
      maximumCanonicalBlocks: 1,
      maximumSections: 100,
    }),
    errorCode('OPENDART_DOCUMENT_XML_TOO_COMPLEX'),
  );
});

test('canonical identities and hashes are deterministic and provenance-sensitive', () => {
  const xml = dartXml('<SECTION-1><TITLE>A</TITLE><P>same</P><P>same</P></SECTION-1>');
  const input = archive([entry(`${RECEIPT}.xml`, xml)]);
  const first = parseFilingDocument(input);
  const second = parseFilingDocument(input);
  assert.deepEqual(
    first.blocks.map(block => [block.blockId, block.contentHash]),
    second.blocks.map(block => [block.blockId, block.contentHash]),
  );
  const duplicates = first.blocks.filter(block => block.sourceText === 'same');
  assert.equal(duplicates.length, 2);
  assert.notEqual(duplicates[0]?.blockId, duplicates[1]?.blockId);
  assert.equal(duplicates[0]?.contentHash, duplicates[1]?.contentHash);

  const otherReceipt = parseFilingDocument(archive([
    entry('20260728000002.xml', xml),
  ], '20260728000002'));
  assert.notEqual(first.blocks[0]?.blockId, otherReceipt.blocks[0]?.blockId);
});

test('text normalization is NFC and preserves financial punctuation', () => {
  assert.equal(
    normalizeFilingText('  매출액\u00a01,234,567백만원\r\n영업이익  -12.4%  '),
    '매출액 1,234,567백만원\n영업이익 -12.4%',
  );
  assert.equal(normalizeFilingText('e\u0301'), 'é');
  const financialValues = '001 | 1,000 | -12.4% | 0.00 | 2026.03.31 | - | 백만원 | 억원';
  assert.equal(normalizeFilingText(financialValues), financialValues);
});
