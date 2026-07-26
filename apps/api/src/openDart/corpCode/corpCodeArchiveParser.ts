import yauzl, { Entry, ZipFile } from 'yauzl';
import { XMLParser } from 'fast-xml-parser';

import { CorpCodeRecord } from '../contracts.js';
import { OpenDartError } from '../errors.js';

export const MAX_CORP_CODE_ZIP_ENTRIES = 8;
export const MAX_CORP_CODE_XML_BYTES = 64 * 1024 * 1024;
export const MAX_CORP_CODE_RECORDS = 200_000;

function openZip(archive: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(archive, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error('ZIP could not be opened'));
      else resolve(zip);
    });
  });
}

function openEntry(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error('ZIP entry could not be opened'));
      else resolve(stream);
    });
  });
}

async function readEntry(zip: ZipFile, entry: Entry, maximumBytes: number): Promise<Buffer> {
  if (entry.uncompressedSize > maximumBytes) {
    throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
  }
  const stream = await openEntry(zip, entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) {
      if ('destroy' in stream && typeof stream.destroy === 'function') stream.destroy();
      throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
    }
    chunks.push(buffer);
  }
  if (size !== entry.uncompressedSize) {
    throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
  }
  return Buffer.concat(chunks);
}

function dateOnly(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) return null;
  const result = `${match[1]}-${match[2]}-${match[3]}`;
  return new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) === result ? result : null;
}

function recordFromRaw(raw: unknown): CorpCodeRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
  }
  const value = raw as Record<string, unknown>;
  const corpCode = typeof value.corp_code === 'string' ? value.corp_code.trim() : '';
  const corpName = typeof value.corp_name === 'string' ? value.corp_name.trim() : '';
  const corpEngName = typeof value.corp_eng_name === 'string' && value.corp_eng_name.trim()
    ? value.corp_eng_name.trim()
    : null;
  const stockCode = typeof value.stock_code === 'string' ? value.stock_code.trim() : '';
  const modified = typeof value.modify_date === 'string' ? dateOnly(value.modify_date.trim()) : null;
  if (!stockCode) return null;
  if (!/^\d{8}$/.test(corpCode) || !corpName || !/^\d{6}$/.test(stockCode) || !modified) {
    throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
  }
  return { corpCode, corpName, corpEngName, stockCode, companyInfoModifiedDate: modified };
}

export function parseCorpCodeXml(xml: Buffer, maximumRecords = MAX_CORP_CODE_RECORDS): CorpCodeRecord[] {
  if (xml.length > MAX_CORP_CODE_XML_BYTES || xml.includes(0)) {
    throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(xml);
  } catch (error) {
    throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false, undefined, { cause: error });
  }
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) {
    throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
  }
  let parsed: unknown;
  try {
    parsed = new XMLParser({ trimValues: false, parseTagValue: false, processEntities: false }).parse(text);
  } catch (error) {
    throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false, undefined, { cause: error });
  }
  const result = (parsed as { result?: { list?: unknown } })?.result?.list;
  const rows = Array.isArray(result) ? result : result ? [result] : [];
  if (rows.length === 0 || rows.length > maximumRecords) {
    throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
  }
  const records: CorpCodeRecord[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const record = recordFromRaw(row);
    if (!record) continue;
    if (seen.has(record.stockCode)) {
      throw new OpenDartError('CORP_CODE_CONFLICT', 'corp-code', false);
    }
    seen.add(record.stockCode);
    records.push(record);
  }
  if (records.length === 0 || records.length > maximumRecords) {
    throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
  }
  return records.sort((a, b) => a.stockCode.localeCompare(b.stockCode));
}

export class CorpCodeArchiveParser {
  async parse(archive: Buffer): Promise<CorpCodeRecord[]> {
    let zip: ZipFile | undefined;
    try {
      zip = await openZip(archive);
      if (zip.entryCount > MAX_CORP_CODE_ZIP_ENTRIES) {
        throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
      }
      const xmlEntries: Entry[] = [];
      for await (const entry of zip.eachEntry()) {
        if (entry.fileName.endsWith('/')) continue;
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
          throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
        }
        if (entry.fileName.toLowerCase().endsWith('.xml')) xmlEntries.push(entry);
      }
      if (xmlEntries.length !== 1 || !xmlEntries[0]) {
        throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false);
      }
      return parseCorpCodeXml(await readEntry(zip, xmlEntries[0], MAX_CORP_CODE_XML_BYTES));
    } catch (error) {
      if (error instanceof OpenDartError) throw error;
      throw new OpenDartError('CORP_CODE_ARCHIVE_INVALID', 'corp-code', false, undefined, { cause: error });
    } finally {
      zip?.close();
    }
  }
}
