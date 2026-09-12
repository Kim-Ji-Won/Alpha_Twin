import { createHash } from 'node:crypto';

import {
  CanonicalFilingBlock,
  CanonicalFilingSection,
  FILING_CHUNKER_VERSION,
  FILING_CHUNK_SCHEMA_VERSION,
} from '../../openDart/document/canonicalFilingContracts.js';
import { PersistCanonicalFilingInput } from './contracts.js';
import { FilingPersistenceError } from './errors.js';
import { flattenSections, FlattenedSection } from './fingerprints.js';
import { filingRepresentationIdentitySeed } from '../../openDart/document/filingXmlDecoding.js';
import { LEGACY_FILING_DECODING_PROFILE } from '../../openDart/document/filingXmlDecoding.js';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const RECEIPT_PATTERN = /^[0-9]{14}$/;
const CORP_CODE_PATTERN = /^[0-9]{8}$/;
const SYMBOL_PATTERN = /^[0-9]{6}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function invalid(): never {
  throw new FilingPersistenceError('FILING_PERSISTENCE_INVALID_INPUT', false);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isValidDateOnly(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month! - 1
    && date.getUTCDate() === day;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertUnique<T>(
  values: readonly T[],
  selector: (value: T) => string | number,
): void {
  if (new Set(values.map(selector)).size !== values.length) invalid();
}

function assertSequentialOrdinals<T>(
  values: readonly T[],
  selector: (value: T) => number,
): void {
  const ordinals = values.map(selector).sort((left, right) => left - right);
  if (ordinals.some((ordinal, index) => ordinal !== index)) invalid();
}

function validateSection(
  flattened: readonly FlattenedSection[],
  blockById: ReadonlyMap<string, CanonicalFilingBlock>,
): void {
  const sectionIds = new Set(flattened.map(item => item.section.sectionId));
  const sectionById = new Map(
    flattened.map(item => [item.section.sectionId, item.section]),
  );
  for (const { section, parentSectionId } of flattened) {
    if (!section.sectionId || section.depth < 0 || section.path.length === 0) invalid();
    if (parentSectionId != null && !sectionIds.has(parentSectionId)) invalid();
    if (parentSectionId == null) {
      if (section.depth !== 1) invalid();
    } else {
      const parent = sectionById.get(parentSectionId);
      if (
        !parent
        || section.depth !== parent.depth + 1
        || !sameStrings(
          section.path.slice(0, -1),
          parent.path,
        )
      ) {
        invalid();
      }
    }
    assertUnique(section.blockIds, value => value);
    for (const blockId of section.blockIds) {
      const block = blockById.get(blockId);
      if (!block || block.sectionId !== section.sectionId) invalid();
    }
  }
}

function validateBlock(
  input: PersistCanonicalFilingInput,
  block: CanonicalFilingBlock,
  sectionIds: ReadonlySet<string>,
): void {
  if (
    !block.blockId
    || !HASH_PATTERN.test(block.contentHash)
    || block.ordinal < 0
    || !block.sourceText
    || !block.retrievalText
    || block.contentHash !== sha256(block.sourceText)
    || (block.sectionId != null && !sectionIds.has(block.sectionId))
    || block.locator.receiptNumber !== input.document.receiptNumber
    || block.locator.entryName !== input.document.source.entryName
    || block.locator.entrySha256 !== input.document.source.entrySha256
    || block.locator.blockOrdinal !== block.ordinal
    || block.locator.blockType !== block.type
    || !sameStrings(block.locator.sectionPath, block.sectionPath)
    || !block.locator.xmlPath
  ) {
    invalid();
  }
  if (block.type === 'table' && block.table.tableId !== block.locator.tableId) invalid();
}

export function validatePersistenceInput(
  input: PersistCanonicalFilingInput,
): {
  readonly sections: readonly FlattenedSection[];
  readonly blocks: readonly CanonicalFilingBlock[];
  readonly chunks: typeof input.chunks;
} {
  const { document, metadata } = input;
  const representationIdentity = filingRepresentationIdentitySeed(
    document.parserVersion,
    document.source.decoding,
  );
  const decoding = document.source.decoding;
  if (
    document.provider !== 'opendart-fss'
    || !RECEIPT_PATTERN.test(document.receiptNumber)
    || !HASH_PATTERN.test(document.source.entrySha256)
    || document.source.byteLength < 0
    || !document.source.entryName
    || !CORP_CODE_PATTERN.test(metadata.corpCode)
    || !SYMBOL_PATTERN.test(metadata.symbol)
    || (metadata.filingDate != null && !isValidDateOnly(metadata.filingDate))
  ) {
    invalid();
  }
  if (decoding && (
    decoding.decodingProfileId !== LEGACY_FILING_DECODING_PROFILE.profileId
    || decoding.decodingProfileFingerprint !== LEGACY_FILING_DECODING_PROFILE.fingerprint
    || decoding.sourceEntrySha256 !== document.source.entrySha256
    || !HASH_PATTERN.test(decoding.canonicalUtf8Sha256)
    || decoding.sourceBomKind !== 'none'
    || decoding.sourceUtf8Validity !== 'invalid'
  )) invalid();

  const sections = flattenSections(document.sections);
  const blocks = [...document.blocks].sort((left, right) => left.ordinal - right.ordinal);
  const chunks = [...input.chunks].sort((left, right) => left.ordinal - right.ordinal);
  assertUnique(sections, item => item.section.sectionId);
  assertUnique(sections, item => item.section.ordinal);
  assertSequentialOrdinals(sections, item => item.section.ordinal);
  assertUnique(blocks, block => block.blockId);
  assertUnique(blocks, block => block.ordinal);
  assertSequentialOrdinals(blocks, block => block.ordinal);
  assertUnique(chunks, chunk => chunk.chunkId);
  assertUnique(chunks, chunk => chunk.ordinal);
  assertSequentialOrdinals(chunks, chunk => chunk.ordinal);

  if (
    document.statistics.sectionCount !== sections.length
    || document.blocks.length !== blocks.length
  ) {
    invalid();
  }

  const blockById = new Map(blocks.map(block => [block.blockId, block]));
  const sectionIds = new Set(sections.map(item => item.section.sectionId));
  const tableIds = blocks.flatMap(block =>
    block.type === 'table' ? [block.table.tableId] : []);
  assertUnique(tableIds, value => value);
  validateSection(sections, blockById);
  for (const block of blocks) validateBlock(input, block, sectionIds);
  for (const block of blocks) {
    if (block.sectionId == null) continue;
    const owner = sections.find(item => item.section.sectionId === block.sectionId);
    if (!owner?.section.blockIds.includes(block.blockId)) invalid();
  }

  for (const chunk of chunks) {
    if (
      !chunk.chunkId
      || chunk.provider !== document.provider
      || chunk.receiptNumber !== document.receiptNumber
      || chunk.sourceEntryHash !== document.source.entrySha256
      || chunk.parserVersion !== document.parserVersion
      || chunk.schemaVersion !== FILING_CHUNK_SCHEMA_VERSION
      || chunk.chunkerVersion !== FILING_CHUNKER_VERSION
      || !HASH_PATTERN.test(chunk.contentHash)
      || chunk.contentHash !== sha256([
        representationIdentity,
        chunk.chunkerVersion,
        chunk.retrievalText,
      ].join('\u001f'))
      || chunk.ordinal < 0
      || !chunk.sourceText
      || !chunk.retrievalText
      || chunk.charCount !== chunk.retrievalText.length
      || chunk.sourceBlockIds.length === 0
      || (chunk.sectionId != null && !sectionIds.has(chunk.sectionId))
      || chunk.locator.entryName !== document.source.entryName
    ) {
      invalid();
    }
    const actualBlockTypes = new Set<string>();
    assertUnique(chunk.sourceBlockIds, value => value);
    chunk.sourceBlockIds.forEach(blockId => {
      const block = blockById.get(blockId);
      if (!block) invalid();
      if (
        block.sectionId !== chunk.sectionId
        || !sameStrings(block.sectionPath, chunk.sectionPath)
      ) {
        invalid();
      }
      actualBlockTypes.add(block.type);
    });
    if (
      actualBlockTypes.size !== chunk.blockTypes.length
      || chunk.blockTypes.some(type => !actualBlockTypes.has(type))
    ) {
      invalid();
    }
    const firstBlock = blockById.get(chunk.sourceBlockIds[0]!);
    const lastBlock = blockById.get(chunk.sourceBlockIds.at(-1)!);
    if (
      !firstBlock
      || !lastBlock
      || chunk.locator.firstBlockOrdinal !== firstBlock.ordinal
      || chunk.locator.lastBlockOrdinal !== lastBlock.ordinal
      || (
        chunk.locator.tableId != null
        && !chunk.sourceBlockIds.some(blockId => {
          const block = blockById.get(blockId);
          return block?.type === 'table'
            && block.table.tableId === chunk.locator.tableId;
        })
      )
    ) {
      invalid();
    }
  }

  return { sections, blocks, chunks };
}
