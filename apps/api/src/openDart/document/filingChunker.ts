import { createHash } from 'node:crypto';

import { OpenDartError } from '../errors.js';
import {
  CanonicalFilingBlock,
  CanonicalFilingDocument,
  CanonicalFilingTableBlock,
  CanonicalFilingTableRow,
  FILING_CHUNK_SCHEMA_VERSION,
  FILING_CHUNKER_VERSION,
  FilingChunk,
} from './canonicalFilingContracts.js';
import {
  DEFAULT_FILING_CHUNK_POLICY,
  FilingChunkPolicy,
  validateFilingChunkPolicy,
} from './filingParserPolicy.js';
import { normalizeFilingText, renderCanonicalTable } from './filingXmlParser.js';

interface PendingChunk {
  readonly sectionId: string | null;
  readonly sectionPath: readonly string[];
  readonly blocks: readonly CanonicalFilingBlock[];
  readonly sourceText: string;
  readonly tableId?: string;
  readonly rowRange?: readonly [number, number];
  readonly repeatedHeaderRowRange?: readonly [number, number];
  readonly continuation?: boolean;
  readonly continuationIndex?: number;
}

function chunkError(cause?: unknown): OpenDartError {
  return new OpenDartError(
    'OPENDART_DOCUMENT_CHUNKING_FAILED',
    'filing-document',
    false,
    undefined,
    cause instanceof Error ? { cause } : undefined,
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safePrefix(
  document: CanonicalFilingDocument,
  sectionPath: readonly string[],
  maximumChars: number,
): string {
  const lines = [
    document.upstreamReportName ?? document.sourceTitle,
    sectionPath.length > 0 ? sectionPath.join(' > ') : null,
  ].filter((value): value is string => Boolean(value));
  const raw = normalizeFilingText(lines.map(line => `[${line}]`).join('\n'));
  const maximumPrefixChars = Math.max(32, Math.floor(maximumChars / 3));
  return raw.length <= maximumPrefixChars
    ? raw
    : `${raw.slice(0, Math.max(1, maximumPrefixChars - 1)).trimEnd()}…`;
}

function sourceBudget(
  document: CanonicalFilingDocument,
  sectionPath: readonly string[],
  maximumChars: number,
): number {
  const prefix = safePrefix(document, sectionPath, maximumChars);
  return Math.max(1, maximumChars - prefix.length - (prefix ? 2 : 0));
}

function splitBounded(text: string, maximumChars: number): string[] {
  const normalized = normalizeFilingText(text);
  if (!normalized) return [];
  if (normalized.length <= maximumChars) return [normalized];
  const pieces: string[] = [];
  let remaining = normalized;
  while (remaining.length > maximumChars) {
    const window = remaining.slice(0, maximumChars + 1);
    const minimumBoundary = Math.floor(maximumChars * 0.55);
    const candidates = [
      window.lastIndexOf('\n\n', maximumChars),
      window.lastIndexOf('\n', maximumChars),
      window.lastIndexOf('. ', maximumChars),
      window.lastIndexOf('다. ', maximumChars),
      window.lastIndexOf('요. ', maximumChars),
      window.lastIndexOf(' ', maximumChars),
    ].filter(index => index >= minimumBoundary);
    const boundary = candidates.length > 0 ? Math.max(...candidates) + 1 : maximumChars;
    const piece = normalizeFilingText(remaining.slice(0, boundary));
    if (piece) pieces.push(piece);
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

function tableHeaderRows(block: CanonicalFilingTableBlock) {
  const headers: CanonicalFilingTableRow[] = [];
  for (const row of block.table.rows) {
    if (!row.isHeader) break;
    headers.push(row);
  }
  return headers;
}

function tablePendingChunks(
  document: CanonicalFilingDocument,
  block: CanonicalFilingTableBlock,
  policy: FilingChunkPolicy,
): PendingChunk[] {
  const budget = sourceBudget(document, block.sectionPath, policy.maximumChars);
  const headers = tableHeaderRows(block);
  const repeatedHeaderRowRange = headers.length > 0
    ? [headers[0]!.rowIndex, headers[headers.length - 1]!.rowIndex] as const
    : undefined;
  if (block.sourceText.length <= budget) {
    return [{
      sectionId: block.sectionId,
      sectionPath: block.sectionPath,
      blocks: [block],
      sourceText: block.sourceText,
      tableId: block.table.tableId,
      rowRange: block.table.rows.length > 0 ? [0, block.table.rows.length - 1] : undefined,
      repeatedHeaderRowRange,
    }];
  }

  const dataRows = block.table.rows.slice(headers.length);
  const chunks: PendingChunk[] = [];
  let group: CanonicalFilingTableRow[] = [];

  const emitRows = (rows: typeof block.table.rows, continuation = false): void => {
    if (rows.length === 0) return;
    const rendered = renderCanonicalTable(block.table, [...headers, ...rows]);
    if (rendered.length <= budget) {
      chunks.push({
        sectionId: block.sectionId,
        sectionPath: block.sectionPath,
        blocks: [block],
        sourceText: rendered,
        tableId: block.table.tableId,
        rowRange: [rows[0]!.rowIndex, rows[rows.length - 1]!.rowIndex],
        repeatedHeaderRowRange,
        continuation,
      });
      return;
    }
    for (const [index, piece] of splitBounded(rendered, budget).entries()) {
      chunks.push({
        sectionId: block.sectionId,
        sectionPath: block.sectionPath,
        blocks: [block],
        sourceText: piece,
        tableId: block.table.tableId,
        rowRange: [rows[0]!.rowIndex, rows[rows.length - 1]!.rowIndex],
        repeatedHeaderRowRange,
        continuation: continuation || index > 0,
        continuationIndex: index,
      });
    }
  };

  if (dataRows.length === 0) {
    for (const [index, piece] of splitBounded(block.sourceText, budget).entries()) {
      chunks.push({
        sectionId: block.sectionId,
        sectionPath: block.sectionPath,
        blocks: [block],
        sourceText: piece,
        tableId: block.table.tableId,
        rowRange: headers.length > 0 ? [0, headers.length - 1] : undefined,
        repeatedHeaderRowRange,
        continuation: index > 0,
        continuationIndex: index,
      });
    }
    return chunks;
  }
  for (const row of dataRows) {
    const candidate = [...group, row];
    const rendered = renderCanonicalTable(block.table, [...headers, ...candidate]);
    if (group.length > 0 && rendered.length > budget) {
      emitRows(group);
      group = [row];
    } else {
      group = candidate;
    }
  }
  emitRows(group);
  return chunks;
}

function pendingTextChunks(
  document: CanonicalFilingDocument,
  blocks: readonly CanonicalFilingBlock[],
  policy: FilingChunkPolicy,
): PendingChunk[] {
  const chunks: PendingChunk[] = [];
  let currentBlocks: CanonicalFilingBlock[] = [];
  let currentText = '';

  const flush = (): void => {
    if (!currentText || currentBlocks.length === 0) return;
    chunks.push({
      sectionId: currentBlocks[0]!.sectionId,
      sectionPath: currentBlocks[0]!.sectionPath,
      blocks: currentBlocks,
      sourceText: currentText,
    });
    currentBlocks = [];
    currentText = '';
  };

  for (const block of blocks) {
    const budget = sourceBudget(document, block.sectionPath, policy.maximumChars);
    const sameSection = currentBlocks.length === 0
      || currentBlocks[0]!.sectionId === block.sectionId;
    const combined = currentText ? `${currentText}\n\n${block.sourceText}` : block.sourceText;
    if (sameSection && combined.length <= budget) {
      currentBlocks.push(block);
      currentText = combined;
      continue;
    }
    flush();
    const pieces = splitBounded(block.sourceText, budget);
    if (pieces.length === 1) {
      currentBlocks = [block];
      currentText = pieces[0]!;
    } else {
      for (const [index, piece] of pieces.entries()) {
        chunks.push({
          sectionId: block.sectionId,
          sectionPath: block.sectionPath,
          blocks: [block],
          sourceText: piece,
          continuation: index > 0,
          continuationIndex: index,
        });
      }
    }
  }
  flush();
  return chunks;
}

export function chunkFilingDocument(
  document: CanonicalFilingDocument,
  chunkPolicy: FilingChunkPolicy = DEFAULT_FILING_CHUNK_POLICY,
): FilingChunk[] {
  const policy = validateFilingChunkPolicy(chunkPolicy);
  try {
    const pending: PendingChunk[] = [];
    let textBlocks: CanonicalFilingBlock[] = [];
    const flushText = (): void => {
      pending.push(...pendingTextChunks(document, textBlocks, policy));
      textBlocks = [];
    };
    for (const block of document.blocks) {
      if (block.type === 'table') {
        flushText();
        pending.push(...tablePendingChunks(document, block, policy));
      } else {
        textBlocks.push(block);
      }
    }
    flushText();

    if (pending.length > policy.maximumChunks) throw chunkError();
    return pending.map((item, ordinal) => {
      const sourceText = normalizeFilingText(item.sourceText);
      if (!sourceText) throw chunkError();
      const prefix = safePrefix(document, item.sectionPath, policy.maximumChars);
      const retrievalText = prefix ? `${prefix}\n\n${sourceText}` : sourceText;
      if (retrievalText.length > policy.maximumChars) throw chunkError();
      const contentHash = sha256([
        document.parserVersion,
        FILING_CHUNKER_VERSION,
        retrievalText,
      ].join('\u001f'));
      const sourceBlockIds = item.blocks.map(block => block.blockId);
      const firstBlock = item.blocks[0];
      const lastBlock = item.blocks[item.blocks.length - 1];
      if (!firstBlock || !lastBlock) throw chunkError();
      return {
        schemaVersion: FILING_CHUNK_SCHEMA_VERSION,
        parserVersion: document.parserVersion,
        chunkerVersion: FILING_CHUNKER_VERSION,
        chunkId: `chk_${sha256([
          document.provider,
          document.receiptNumber,
          document.source.entrySha256,
          document.parserVersion,
          FILING_CHUNKER_VERSION,
          ordinal,
          sourceBlockIds.join(','),
          item.rowRange?.join('-') ?? '',
          contentHash,
        ].join('\u001f')).slice(0, 32)}`,
        provider: document.provider,
        receiptNumber: document.receiptNumber,
        sourceEntryHash: document.source.entrySha256,
        ordinal,
        sectionId: item.sectionId,
        sectionPath: item.sectionPath,
        sourceBlockIds,
        blockTypes: [...new Set(item.blocks.map(block => block.type))],
        sourceText,
        retrievalText,
        contentHash,
        charCount: retrievalText.length,
        locator: {
          entryName: document.source.entryName,
          firstBlockOrdinal: firstBlock.ordinal,
          lastBlockOrdinal: lastBlock.ordinal,
          tableId: item.tableId,
          rowRange: item.rowRange,
          repeatedHeaderRowRange: item.repeatedHeaderRowRange,
          continuation: item.continuation,
          continuationIndex: item.continuationIndex,
        },
      };
    });
  } catch (error) {
    if (
      error instanceof OpenDartError
      && error.code === 'OPENDART_DOCUMENT_CHUNKING_FAILED'
    ) {
      throw error;
    }
    throw chunkError(error);
  }
}
