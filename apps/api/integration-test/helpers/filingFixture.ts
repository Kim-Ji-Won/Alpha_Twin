import { createHash } from 'node:crypto';

import {
  PersistCanonicalFilingInput,
} from '../../src/filingIntelligence/persistence/contracts.js';
import {
  ValidatedDisclosureDocumentArchive,
  ValidatedDisclosureDocumentEntry,
} from '../../src/openDart/document/documentContracts.js';
import { chunkFilingDocument } from '../../src/openDart/document/filingChunker.js';
import { parseFilingDocument } from '../../src/openDart/document/filingXmlParser.js';

export const SYNTHETIC_RECEIPT = '20990101000001';

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function syntheticPersistenceInput(
  paragraphCount = 5,
): PersistCanonicalFilingInput {
  const paragraphs = Array.from(
    { length: paragraphCount },
    (_, index) => `<P>합성 문단 ${index + 1}의 검증 데이터입니다.</P>`,
  ).join('');
  const content = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
    <DOCUMENT>
      <DOCUMENT-NAME>ALPHA TWIN TEST REPORT</DOCUMENT-NAME>
      <BODY>
        <SECTION-1>
          <TITLE>합성 사업 정보</TITLE>
          ${paragraphs}
          <SECTION-2>
            <TITLE>합성 재무 표</TITLE>
            <TABLE-GROUP>
              <TITLE>합성 단위 표</TITLE>
              <P>(단위: 백만원)</P>
              <TABLE>
                <THEAD>
                  <TR><TH rowspan="2">항목</TH><TH colspan="2">금액</TH></TR>
                  <TR><TH>당기</TH><TH>전기</TH></TR>
                </THEAD>
                <TBODY>
                  <TR><TD>코드</TD><TD>001</TD><TD></TD></TR>
                  <TR><TD>매출</TD><TD>1,000</TD><TD>-12.4%</TD></TR>
                  <TR><TD>비율</TD><TD>0.00</TD><TD>100</TD></TR>
                </TBODY>
              </TABLE>
            </TABLE-GROUP>
          </SECTION-2>
        </SECTION-1>
      </BODY>
    </DOCUMENT>`);
  const entry: ValidatedDisclosureDocumentEntry = {
    entryName: `${SYNTHETIC_RECEIPT}.xml`,
    format: 'xml',
    mediaType: 'application/xml',
    compressedSize: content.length,
    uncompressedSize: content.length,
    sha256: sha256(content),
    content,
  };
  const archive: ValidatedDisclosureDocumentArchive = {
    provider: 'opendart-fss',
    receiptNumber: SYNTHETIC_RECEIPT,
    archiveByteLength: content.length,
    archiveSha256: entry.sha256,
    archiveEntryCount: 1,
    declaredTotalUncompressedBytes: content.length,
    extractedTotalUncompressedBytes: content.length,
    entries: [entry],
  };
  const document = parseFilingDocument(archive, {
    upstreamReportName: '합성 사업보고서',
  });
  return {
    metadata: {
      corpCode: '99999999',
      symbol: '999999',
      companyName: 'ALPHA TWIN TEST COMPANY',
      reportName: '합성 사업보고서',
      reportCode: '11011',
      filingDate: '2099-01-01',
    },
    document,
    chunks: chunkFilingDocument(document, {
      maximumChars: 280,
      maximumChunks: 500,
    }),
  };
}
