import { createHash } from 'node:crypto';

import { XMLParser, XMLValidator } from 'fast-xml-parser';

import { OpenDartError } from '../errors.js';
import {
  CANONICAL_FILING_SCHEMA_NAME,
  CANONICAL_FILING_SCHEMA_VERSION,
  CanonicalFilingBlock,
  CanonicalFilingDocument,
  CanonicalFilingSection,
  CanonicalFilingTable,
  CanonicalFilingTableBlock,
  CanonicalFilingTableCell,
  CanonicalFilingTableRow,
  FILING_XML_PARSER_VERSION,
  FilingParserContext,
} from './canonicalFilingContracts.js';
import {
  ValidatedDisclosureDocumentArchive,
  ValidatedDisclosureDocumentEntry,
} from './documentContracts.js';
import {
  DEFAULT_FILING_PARSER_POLICY,
  FilingParserPolicy,
  validateFilingParserPolicy,
} from './filingParserPolicy.js';
import {
  FilingXmlCompatibilityResult,
  normalizeOpenDartXmlCompatibility,
} from './filingXmlSafety.js';
import {
  decodeValidatedOpenDartMainEntry,
  filingRepresentationIdentitySeed,
  OpenDartDecodedMainEntry,
} from './filingXmlDecoding.js';

type OrderedNode = Record<string, unknown>;

interface ParsedOrderedNode {
  readonly tag: string;
  readonly normalizedTag: string;
  readonly children: readonly OrderedNode[];
  readonly attributes: Readonly<Record<string, string>>;
}

interface CandidateProfile {
  readonly entry: ValidatedDisclosureDocumentEntry;
  readonly rootTag: string;
  readonly rank: readonly number[];
  readonly eligible: boolean;
}

interface MutableSection {
  readonly sectionId: string;
  readonly title: string | null;
  readonly depth: number;
  readonly path: readonly string[];
  readonly ordinal: number;
  readonly blockIds: string[];
  readonly children: MutableSection[];
}

const SECTION_TAG = /^SECTION(?:-\d+)?$/;
const TABLE_CONTAINER_TAGS = new Set(['TABLE', 'TABLE-GROUP']);
const TABLE_CELL_TAGS = new Set(['TH', 'TD', 'TE', 'TU']);
const TEXT_BLOCK_TAGS = new Set(['P', 'PARAGRAPH']);
const NOTE_BLOCK_TAGS = new Set(['NOTE', 'FOOTNOTE', 'CAPTION', 'UNIT']);
const BREAK_TAGS = new Set(['BR', 'PGBRK']);
const CONTAINER_TAGS = new Set([
  'DOCUMENT',
  'HTML',
  'HEAD',
  'BODY',
  'COVER',
  'SUMMARY',
  'CORRECTION',
  'DIV',
  'ARTICLE',
  'MAIN',
]);
const NON_SEMANTIC_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'META',
  'LINK',
]);
const TITLE_TAGS = new Set(['DOCUMENT-NAME', 'COVER-TITLE', 'TITLE']);
const OPENDART_UNPAIRED_TAGS: string[] = [];

function parserError(
  code:
    | 'OPENDART_DOCUMENT_MALFORMED_XML'
    | 'OPENDART_DOCUMENT_XML_TOO_COMPLEX'
    | 'OPENDART_DOCUMENT_NO_MAIN_DOCUMENT'
    | 'OPENDART_DOCUMENT_AMBIGUOUS_MAIN_DOCUMENT'
    | 'OPENDART_DOCUMENT_CANONICALIZATION_FAILED',
  cause?: unknown,
): OpenDartError {
  return new OpenDartError(
    code,
    'filing-document',
    false,
    undefined,
    cause instanceof Error ? { cause } : undefined,
  );
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function opaqueId(prefix: string, parts: readonly (string | number)[]): string {
  return `${prefix}_${sha256(parts.join('\u001f')).slice(0, 32)}`;
}

function normalizedTag(tag: string): string {
  return (tag.includes(':') ? tag.slice(tag.lastIndexOf(':') + 1) : tag).toUpperCase();
}

function orderedNode(value: unknown): ParsedOrderedNode | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as OrderedNode;
  const tag = Object.keys(record).find(key => key !== ':@');
  if (!tag) return null;
  const rawChildren = record[tag];
  const rawAttributes = record[':@'];
  const attributes: Record<string, string> = {};
  if (rawAttributes && typeof rawAttributes === 'object' && !Array.isArray(rawAttributes)) {
    for (const [key, attribute] of Object.entries(rawAttributes as Record<string, unknown>)) {
      if (typeof attribute === 'string') attributes[key] = attribute;
    }
  }
  return {
    tag,
    normalizedTag: normalizedTag(tag),
    children: Array.isArray(rawChildren)
      ? rawChildren.filter(child => child != null && typeof child === 'object') as OrderedNode[]
      : [],
    attributes,
  };
}

function childIdentities(children: readonly OrderedNode[]): Array<{
  readonly parsed: ParsedOrderedNode;
  readonly segment: string;
}> {
  const counts = new Map<string, number>();
  const result: Array<{ parsed: ParsedOrderedNode; segment: string }> = [];
  for (const child of children) {
    const parsed = orderedNode(child);
    if (!parsed) continue;
    const index = counts.get(parsed.normalizedTag) ?? 0;
    counts.set(parsed.normalizedTag, index + 1);
    result.push({ parsed, segment: `${parsed.normalizedTag}[${index}]` });
  }
  return result;
}

export function normalizeFilingText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]*\n[ ]*/g, '\n')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function inlineText(
  children: readonly OrderedNode[],
  excludeStructural = true,
): string {
  let result = '';
  for (const child of children) {
    const parsed = orderedNode(child);
    if (!parsed) continue;
    if (parsed.tag === '#text') {
      const text = child['#text'];
      if (typeof text === 'string') result += text;
      continue;
    }
    if (parsed.tag === '#cdata') {
      result += inlineText(parsed.children, false);
      continue;
    }
    if (parsed.tag.startsWith('?') || parsed.tag === '#comment') continue;
    if (NON_SEMANTIC_TAGS.has(parsed.normalizedTag)) continue;
    if (BREAK_TAGS.has(parsed.normalizedTag)) {
      result += '\n';
      continue;
    }
    if (
      excludeStructural
      && (SECTION_TAG.test(parsed.normalizedTag) || TABLE_CONTAINER_TAGS.has(parsed.normalizedTag))
    ) {
      continue;
    }
    result += inlineText(parsed.children, excludeStructural);
  }
  return normalizeFilingText(result);
}

function countStructure(
  nodes: readonly OrderedNode[],
  policy: FilingParserPolicy,
): { structuralNodeCount: number; maximumDepth: number } {
  let structuralNodeCount = 0;
  let maximumDepth = 0;
  const visit = (children: readonly OrderedNode[], depth: number): void => {
    if (depth > policy.maximumDepth) {
      throw parserError('OPENDART_DOCUMENT_XML_TOO_COMPLEX');
    }
    maximumDepth = Math.max(maximumDepth, depth);
    for (const child of children) {
      const parsed = orderedNode(child);
      if (!parsed) continue;
      structuralNodeCount += 1;
      if (structuralNodeCount > policy.maximumStructuralNodes) {
        throw parserError('OPENDART_DOCUMENT_XML_TOO_COMPLEX');
      }
      visit(parsed.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return { structuralNodeCount, maximumDepth };
}

function parseOrderedXml(text: string, policy: FilingParserPolicy): readonly OrderedNode[] {
  const validation = XMLValidator.validate(text, {
    allowBooleanAttributes: false,
    unpairedTags: OPENDART_UNPAIRED_TAGS,
  });
  if (validation !== true) {
    throw parserError('OPENDART_DOCUMENT_MALFORMED_XML');
  }
  try {
    const parsed: unknown = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      allowBooleanAttributes: false,
      unpairedTags: OPENDART_UNPAIRED_TAGS,
      attributeNamePrefix: '',
      trimValues: false,
      parseTagValue: false,
      parseAttributeValue: false,
      processEntities: {
        enabled: true,
        maxEntitySize: 1,
        maxExpansionDepth: 1,
        maxTotalExpansions: 1_000_000,
        maxExpandedLength: 64 * 1024 * 1024,
        maxEntityCount: 1,
      },
      cdataPropName: '#cdata',
      commentPropName: false,
      ignoreDeclaration: false,
      ignorePiTags: true,
      maxNestedTags: policy.maximumDepth,
    }).parse(text);
    if (!Array.isArray(parsed)) {
      throw parserError('OPENDART_DOCUMENT_MALFORMED_XML');
    }
    return parsed.filter(node => node != null && typeof node === 'object') as OrderedNode[];
  } catch (error) {
    if (error instanceof OpenDartError) throw error;
    if (error instanceof Error && /Maximum nested tags exceeded/i.test(error.message)) {
      throw parserError('OPENDART_DOCUMENT_XML_TOO_COMPLEX', error);
    }
    throw parserError('OPENDART_DOCUMENT_MALFORMED_XML', error);
  }
}

function tagCount(text: string, tag: string): number {
  return [...text.matchAll(new RegExp(`<\\s*${tag}\\b`, 'gi'))].length;
}

function entryBaseName(entryName: string): string {
  return entryName.slice(entryName.lastIndexOf('/') + 1);
}

function candidateProfile(
  archive: ValidatedDisclosureDocumentArchive,
  entry: ValidatedDisclosureDocumentEntry,
): CandidateProfile {
  // Main-entry ranking only depends on ASCII XML structure. Full semantic
  // decoding is deferred until the validated OpenDART main entry is selected.
  const text = entry.content.toString('latin1');
  const rootTag = normalizedTag(
    /<(?![!?/])\s*([A-Za-z_][A-Za-z0-9:_.-]*)\b/.exec(text)?.[1] ?? '',
  );
  const bodyCount = tagCount(text, 'BODY');
  const sectionCount = tagCount(text, 'SECTION(?:-\\d+)?');
  const titleCount = tagCount(text, 'TITLE');
  const paragraphCount = tagCount(text, 'P');
  const tableCount = tagCount(text, 'TABLE');
  const semanticCount = sectionCount + titleCount + paragraphCount + tableCount;
  const fileName = entryBaseName(entry.entryName);
  const exactReceiptName = fileName.toLowerCase() === `${archive.receiptNumber}.xml`;
  const attachmentLike = /(?:^|[_-])\d{5}\.xml$/i.test(fileName)
    || /(?:attach|appendix|exhibit|xbrl)/i.test(fileName);
  const eligible = rootTag === 'DOCUMENT'
    || rootTag === 'HTML'
    || bodyCount > 0
    || semanticCount > 0;
  return {
    entry,
    rootTag,
    eligible,
    rank: [
      exactReceiptName ? 1 : 0,
      attachmentLike ? 0 : 1,
      rootTag === 'DOCUMENT' ? 2 : rootTag === 'HTML' ? 1 : 0,
      bodyCount > 0 ? 1 : 0,
      sectionCount > 0 ? 1 : 0,
      titleCount > 0 ? 1 : 0,
      Math.min(semanticCount, 1_000_000),
    ],
  };
}

function compareRank(left: CandidateProfile, right: CandidateProfile): number {
  for (let index = 0; index < left.rank.length; index += 1) {
    const difference = (right.rank[index] ?? 0) - (left.rank[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function selectMainEntry(
  archive: ValidatedDisclosureDocumentArchive,
): CandidateProfile {
  const eligible = archive.entries
    .map(entry => candidateProfile(archive, entry))
    .filter(candidate => candidate.eligible)
    .sort(compareRank);
  if (eligible.length === 0) {
    throw parserError('OPENDART_DOCUMENT_NO_MAIN_DOCUMENT');
  }
  if (eligible[1] && compareRank(eligible[0]!, eligible[1]) === 0) {
    throw parserError('OPENDART_DOCUMENT_AMBIGUOUS_MAIN_DOCUMENT');
  }
  return eligible[0]!;
}

function firstSourceTitle(nodes: readonly OrderedNode[]): string | null {
  let result: string | null = null;
  const visit = (children: readonly OrderedNode[]): void => {
    for (const child of children) {
      if (result) return;
      const parsed = orderedNode(child);
      if (!parsed) continue;
      if (TITLE_TAGS.has(parsed.normalizedTag)) {
        const text = inlineText(parsed.children);
        if (text) {
          result = text;
          return;
        }
      }
      if (!NON_SEMANTIC_TAGS.has(parsed.normalizedTag)) visit(parsed.children);
    }
  };
  visit(nodes);
  return result;
}

function positiveSpan(attributes: Readonly<Record<string, string>>, name: string): number {
  const value = Object.entries(attributes)
    .find(([key]) => normalizedTag(key) === name)?.[1];
  if (!value || !/^\d+$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function tableRows(tableNode: ParsedOrderedNode): CanonicalFilingTableRow[] {
  const rows: CanonicalFilingTableRow[] = [];
  const visit = (children: readonly OrderedNode[], inHeader: boolean): void => {
    for (const child of children) {
      const parsed = orderedNode(child);
      if (!parsed || NON_SEMANTIC_TAGS.has(parsed.normalizedTag)) continue;
      if (parsed.normalizedTag === 'TABLE') continue;
      const nextHeader = inHeader || parsed.normalizedTag === 'THEAD';
      if (parsed.normalizedTag === 'TR') {
        const cells: CanonicalFilingTableCell[] = [];
        for (const { parsed: cell } of childIdentities(parsed.children)) {
          if (!TABLE_CELL_TAGS.has(cell.normalizedTag)) continue;
          cells.push({
            columnIndex: cells.length,
            kind: cell.normalizedTag === 'TH' || nextHeader ? 'header' : 'data',
            text: inlineText(cell.children, false),
            rowSpan: positiveSpan(cell.attributes, 'ROWSPAN'),
            columnSpan: positiveSpan(cell.attributes, 'COLSPAN'),
          });
        }
        if (cells.length > 0) {
          rows.push({
            rowIndex: rows.length,
            isHeader: nextHeader || cells.some(cell => cell.kind === 'header'),
            cells,
          });
        }
        continue;
      }
      visit(parsed.children, nextHeader);
    }
  };
  visit(tableNode.children, false);
  return rows;
}

export function renderCanonicalTable(
  table: Pick<CanonicalFilingTable, 'caption' | 'contextText' | 'rows'>,
  rows: readonly CanonicalFilingTableRow[] = table.rows,
): string {
  const lines = [
    ...(table.caption ? [table.caption] : []),
    ...table.contextText,
    ...rows.map(row => row.cells.map(cell => cell.text).join(' | ')),
  ];
  return normalizeFilingText(lines.join('\n'));
}

function freezeSection(section: MutableSection): CanonicalFilingSection {
  return {
    sectionId: section.sectionId,
    title: section.title,
    depth: section.depth,
    path: section.path,
    ordinal: section.ordinal,
    blockIds: section.blockIds,
    children: section.children.map(freezeSection),
  };
}

function canonicalize(
  archive: ValidatedDisclosureDocumentArchive,
  profile: CandidateProfile,
  nodes: readonly OrderedNode[],
  policy: FilingParserPolicy,
  context: FilingParserContext,
  compatibility: FilingXmlCompatibilityResult['repairs'],
  decoded: OpenDartDecodedMainEntry,
): CanonicalFilingDocument {
  const structure = countStructure(nodes, policy);
  const blocks: CanonicalFilingBlock[] = [];
  const rootSections: MutableSection[] = [];
  let sectionOrdinal = 0;
  const identitySeed = filingRepresentationIdentitySeed(
    FILING_XML_PARSER_VERSION,
    decoded.provenance,
  );

  const addTextBlock = (
    type: 'heading' | 'paragraph' | 'note',
    text: string,
    section: MutableSection | null,
    xmlPath: string,
  ): void => {
    const sourceText = normalizeFilingText(text);
    if (!sourceText) return;
    if (blocks.length >= policy.maximumCanonicalBlocks) {
      throw parserError('OPENDART_DOCUMENT_XML_TOO_COMPLEX');
    }
    const ordinal = blocks.length;
    const contentHash = sha256(sourceText);
    const blockId = opaqueId('blk', [
      archive.provider,
      archive.receiptNumber,
      profile.entry.sha256,
      identitySeed,
      xmlPath,
      ordinal,
      type,
      contentHash,
    ]);
    const block: CanonicalFilingBlock = {
      blockId,
      contentHash,
      type,
      ordinal,
      sectionId: section?.sectionId ?? null,
      sectionPath: section?.path ?? [],
      sourceText,
      retrievalText: sourceText,
      locator: {
        receiptNumber: archive.receiptNumber,
        entryName: profile.entry.entryName,
        entrySha256: profile.entry.sha256,
        xmlPath,
        sectionPath: section?.path ?? [],
        blockOrdinal: ordinal,
        blockType: type,
      },
    };
    blocks.push(block);
    section?.blockIds.push(blockId);
  };

  const addTableBlock = (
    tableNode: ParsedOrderedNode,
    section: MutableSection | null,
    xmlPath: string,
    caption: string | null,
    contextText: readonly string[],
  ): void => {
    const rows = tableRows(tableNode);
    if (rows.length === 0 && !caption && contextText.length === 0) return;
    if (blocks.length >= policy.maximumCanonicalBlocks) {
      throw parserError('OPENDART_DOCUMENT_XML_TOO_COMPLEX');
    }
    const tableId = opaqueId('tbl', [
      archive.provider,
      archive.receiptNumber,
      profile.entry.sha256,
      identitySeed,
      xmlPath,
    ]);
    const table: CanonicalFilingTable = {
      tableId,
      caption,
      contextText,
      rows,
    };
    const sourceText = renderCanonicalTable(table);
    if (!sourceText) return;
    const ordinal = blocks.length;
    const contentHash = sha256(sourceText);
    const blockId = opaqueId('blk', [
      archive.provider,
      archive.receiptNumber,
      profile.entry.sha256,
      identitySeed,
      xmlPath,
      ordinal,
      'table',
      contentHash,
    ]);
    const block: CanonicalFilingTableBlock = {
      blockId,
      contentHash,
      type: 'table',
      ordinal,
      sectionId: section?.sectionId ?? null,
      sectionPath: section?.path ?? [],
      sourceText,
      retrievalText: sourceText,
      table,
      locator: {
        receiptNumber: archive.receiptNumber,
        entryName: profile.entry.entryName,
        entrySha256: profile.entry.sha256,
        xmlPath,
        sectionPath: section?.path ?? [],
        blockOrdinal: ordinal,
        blockType: 'table',
        tableId,
        rowRange: rows.length > 0 ? [0, rows.length - 1] : undefined,
      },
    };
    blocks.push(block);
    section?.blockIds.push(blockId);
  };

  const walk = (
    children: readonly OrderedNode[],
    section: MutableSection | null,
    parentPath: string,
  ): void => {
    for (const { parsed, segment } of childIdentities(children)) {
      const xmlPath = parentPath ? `${parentPath}/${segment}` : `/${segment}`;
      const tag = parsed.normalizedTag;
      if (parsed.tag.startsWith('?') || parsed.tag === '#comment' || parsed.tag === '#text') {
        continue;
      }
      if (NON_SEMANTIC_TAGS.has(tag)) continue;

      if (SECTION_TAG.test(tag)) {
        if (sectionOrdinal >= policy.maximumSections) {
          throw parserError('OPENDART_DOCUMENT_XML_TOO_COMPLEX');
        }
        const directTitle = childIdentities(parsed.children)
          .find(child => child.parsed.normalizedTag === 'TITLE');
        const title = directTitle ? inlineText(directTitle.parsed.children) || null : null;
        const ordinal = sectionOrdinal;
        sectionOrdinal += 1;
        const pathLabel = title ?? `(untitled ${ordinal + 1})`;
        const path = [...(section?.path ?? []), pathLabel];
        const current: MutableSection = {
          sectionId: opaqueId('sec', [
            archive.provider,
            archive.receiptNumber,
            profile.entry.sha256,
            identitySeed,
            xmlPath,
            ordinal,
            title ?? '',
          ]),
          title,
          depth: section ? section.depth + 1 : 1,
          path,
          ordinal,
          blockIds: [],
          children: [],
        };
        if (section) section.children.push(current);
        else rootSections.push(current);
        walk(parsed.children, current, xmlPath);
        continue;
      }

      if (tag === 'TABLE-GROUP') {
        const groupChildren = childIdentities(parsed.children);
        const titleTexts = groupChildren
          .filter(child => child.parsed.normalizedTag === 'TITLE')
          .map(child => inlineText(child.parsed.children))
          .filter(Boolean);
        const caption = titleTexts[0] ?? null;
        const contextText: string[] = [];
        contextText.push(...titleTexts.slice(1));
        contextText.push(...groupChildren
          .filter(child => TEXT_BLOCK_TAGS.has(child.parsed.normalizedTag))
          .map(child => inlineText(child.parsed.children))
          .filter(Boolean));
        for (const { parsed: groupChild, segment: groupSegment } of groupChildren) {
          const childPath = `${xmlPath}/${groupSegment}`;
          if (groupChild.normalizedTag === 'TABLE') {
            addTableBlock(groupChild, section, childPath, caption, contextText);
          } else if (
            groupChild.normalizedTag !== 'TITLE'
            && !TEXT_BLOCK_TAGS.has(groupChild.normalizedTag)
            && !NON_SEMANTIC_TAGS.has(groupChild.normalizedTag)
          ) {
            walk(groupChild.children, section, childPath);
          }
        }
        continue;
      }
      if (tag === 'TABLE') {
        addTableBlock(parsed, section, xmlPath, null, []);
        continue;
      }
      if (tag === 'TITLE') {
        addTextBlock('heading', inlineText(parsed.children), section, xmlPath);
        continue;
      }
      if (TEXT_BLOCK_TAGS.has(tag)) {
        addTextBlock('paragraph', inlineText(parsed.children), section, xmlPath);
        continue;
      }
      if (NOTE_BLOCK_TAGS.has(tag)) {
        addTextBlock('note', inlineText(parsed.children), section, xmlPath);
        continue;
      }
      if (CONTAINER_TAGS.has(tag)) {
        walk(parsed.children, section, xmlPath);
        continue;
      }

      const hasStructuralChild = childIdentities(parsed.children).some(child =>
        SECTION_TAG.test(child.parsed.normalizedTag)
        || TABLE_CONTAINER_TAGS.has(child.parsed.normalizedTag)
        || TEXT_BLOCK_TAGS.has(child.parsed.normalizedTag)
        || child.parsed.normalizedTag === 'TITLE'
        || NOTE_BLOCK_TAGS.has(child.parsed.normalizedTag));
      if (hasStructuralChild) {
        walk(parsed.children, section, xmlPath);
      } else {
        addTextBlock('paragraph', inlineText(parsed.children), section, xmlPath);
      }
    }
  };

  try {
    walk(nodes, null, '');
  } catch (error) {
    if (error instanceof OpenDartError) throw error;
    throw parserError('OPENDART_DOCUMENT_CANONICALIZATION_FAILED', error);
  }

  return {
    schemaName: CANONICAL_FILING_SCHEMA_NAME,
    schemaVersion: CANONICAL_FILING_SCHEMA_VERSION,
    parserVersion: FILING_XML_PARSER_VERSION,
    provider: archive.provider,
    receiptNumber: archive.receiptNumber,
    sourceTitle: firstSourceTitle(nodes),
    upstreamReportName: context.upstreamReportName?.trim() || null,
    source: {
      entryName: profile.entry.entryName,
      entrySha256: profile.entry.sha256,
      byteLength: profile.entry.content.length,
      encoding: 'utf-8',
      rootTag: profile.rootTag,
      ...(decoded.provenance ? { decoding: decoded.provenance } : {}),
      ...(compatibility.bareAmpersandCount > 0
        || compatibility.literalAngleBracketCount > 0
        || (compatibility.carriageReturnEntityCount ?? 0) > 0
        ? {
            compatibility: {
              mode: 'opendart-xml-v1' as const,
              repairs: {
                ...(compatibility.bareAmpersandCount > 0
                  ? { bareAmpersandCount: compatibility.bareAmpersandCount }
                  : {}),
                ...(compatibility.literalAngleBracketCount > 0
                  ? { literalAngleBracketCount: compatibility.literalAngleBracketCount }
                  : {}),
                ...((compatibility.carriageReturnEntityCount ?? 0) > 0
                  ? { carriageReturnEntityCount: compatibility.carriageReturnEntityCount }
                  : {}),
              },
            },
          }
        : {}),
    },
    sections: rootSections.map(freezeSection),
    blocks,
    statistics: {
      ...structure,
      sectionCount: sectionOrdinal,
      paragraphBlockCount: blocks.filter(block => block.type === 'paragraph').length,
      tableBlockCount: blocks.filter(block => block.type === 'table').length,
    },
  };
}

export function parseFilingDocument(
  archive: ValidatedDisclosureDocumentArchive,
  context: FilingParserContext = {},
  parserPolicy: FilingParserPolicy = DEFAULT_FILING_PARSER_POLICY,
): CanonicalFilingDocument {
  const policy = validateFilingParserPolicy(parserPolicy);
  const profile = selectMainEntry(archive);
  if (sha256(profile.entry.content) !== profile.entry.sha256) {
    throw parserError('OPENDART_DOCUMENT_CANONICALIZATION_FAILED');
  }
  const decoded = decodeValidatedOpenDartMainEntry(profile.entry.content, {
    provider: archive.provider,
    safeArchiveValidated: true,
    mainEntrySelected: true,
    sourceEntrySha256: profile.entry.sha256,
  });
  const compatibility = normalizeOpenDartXmlCompatibility(decoded.text, {
    allowLegacyCarriageReturnEntity: decoded.provenance != null,
    allowLegacyKoreanAngleLabels: decoded.provenance != null,
  });
  const nodes = parseOrderedXml(compatibility.text, policy);
  return canonicalize(
    archive,
    profile,
    nodes,
    policy,
    context,
    compatibility.repairs,
    decoded,
  );
}
