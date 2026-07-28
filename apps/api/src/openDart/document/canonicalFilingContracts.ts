export const CANONICAL_FILING_SCHEMA_NAME = 'canonical-filing-document';
export const CANONICAL_FILING_SCHEMA_VERSION = 1;
// Bump parser for canonical text, table, locator, or canonical ID semantic changes.
export const FILING_XML_PARSER_VERSION = '1.0.1';
export const FILING_CHUNK_SCHEMA_VERSION = 1;
// Bump chunker for boundary, retrieval prefix, chunk ID, or chunk hash changes.
export const FILING_CHUNKER_VERSION = '1.0.1';

export type CanonicalFilingBlockType = 'heading' | 'paragraph' | 'note' | 'table';

export interface FilingSourceLocator {
  readonly receiptNumber: string;
  readonly entryName: string;
  readonly entrySha256: string;
  readonly xmlPath: string;
  readonly sectionPath: readonly string[];
  readonly blockOrdinal: number;
  readonly blockType: CanonicalFilingBlockType;
  readonly tableId?: string;
  readonly rowRange?: readonly [number, number];
}

interface CanonicalFilingBlockBase {
  readonly blockId: string;
  readonly contentHash: string;
  readonly type: CanonicalFilingBlockType;
  readonly ordinal: number;
  readonly sectionId: string | null;
  readonly sectionPath: readonly string[];
  readonly sourceText: string;
  readonly retrievalText: string;
  readonly locator: FilingSourceLocator;
}

export interface CanonicalFilingTextBlock extends CanonicalFilingBlockBase {
  readonly type: 'heading' | 'paragraph' | 'note';
}

export interface CanonicalFilingTableCell {
  readonly columnIndex: number;
  readonly kind: 'header' | 'data';
  readonly text: string;
  readonly rowSpan: number;
  readonly columnSpan: number;
}

export interface CanonicalFilingTableRow {
  readonly rowIndex: number;
  readonly isHeader: boolean;
  readonly cells: readonly CanonicalFilingTableCell[];
}

export interface CanonicalFilingTable {
  readonly tableId: string;
  readonly caption: string | null;
  readonly contextText: readonly string[];
  readonly rows: readonly CanonicalFilingTableRow[];
}

export interface CanonicalFilingTableBlock extends CanonicalFilingBlockBase {
  readonly type: 'table';
  readonly table: CanonicalFilingTable;
}

export type CanonicalFilingBlock =
  | CanonicalFilingTextBlock
  | CanonicalFilingTableBlock;

export interface CanonicalFilingSection {
  readonly sectionId: string;
  readonly title: string | null;
  readonly depth: number;
  readonly path: readonly string[];
  readonly ordinal: number;
  readonly blockIds: readonly string[];
  readonly children: readonly CanonicalFilingSection[];
}

export interface CanonicalFilingDocument {
  readonly schemaName: typeof CANONICAL_FILING_SCHEMA_NAME;
  readonly schemaVersion: typeof CANONICAL_FILING_SCHEMA_VERSION;
  readonly parserVersion: typeof FILING_XML_PARSER_VERSION;
  readonly provider: 'opendart-fss';
  readonly receiptNumber: string;
  readonly sourceTitle: string | null;
  readonly upstreamReportName: string | null;
  readonly source: {
    readonly entryName: string;
    readonly entrySha256: string;
    readonly byteLength: number;
    readonly encoding: 'utf-8';
    readonly rootTag: string;
    readonly compatibility?: {
      readonly mode: 'opendart-xml-v1';
      readonly repairs: {
        readonly bareAmpersandCount?: number;
        readonly literalAngleBracketCount?: number;
      };
    };
  };
  readonly sections: readonly CanonicalFilingSection[];
  readonly blocks: readonly CanonicalFilingBlock[];
  readonly statistics: {
    readonly structuralNodeCount: number;
    readonly maximumDepth: number;
    readonly sectionCount: number;
    readonly paragraphBlockCount: number;
    readonly tableBlockCount: number;
  };
}

export interface FilingChunk {
  readonly schemaVersion: typeof FILING_CHUNK_SCHEMA_VERSION;
  readonly parserVersion: typeof FILING_XML_PARSER_VERSION;
  readonly chunkerVersion: typeof FILING_CHUNKER_VERSION;
  readonly chunkId: string;
  readonly provider: 'opendart-fss';
  readonly receiptNumber: string;
  readonly sourceEntryHash: string;
  readonly ordinal: number;
  readonly sectionId: string | null;
  readonly sectionPath: readonly string[];
  readonly sourceBlockIds: readonly string[];
  readonly blockTypes: readonly CanonicalFilingBlockType[];
  readonly sourceText: string;
  readonly retrievalText: string;
  readonly contentHash: string;
  readonly charCount: number;
  readonly locator: {
    readonly entryName: string;
    readonly firstBlockOrdinal: number;
    readonly lastBlockOrdinal: number;
    readonly tableId?: string;
    readonly rowRange?: readonly [number, number];
    readonly repeatedHeaderRowRange?: readonly [number, number];
    readonly continuation?: boolean;
    readonly continuationIndex?: number;
  };
}

export interface FilingParserContext {
  readonly upstreamReportName?: string;
}
