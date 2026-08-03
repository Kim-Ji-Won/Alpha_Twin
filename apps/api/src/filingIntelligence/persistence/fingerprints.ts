import { createHash } from 'node:crypto';

import {
  CanonicalFilingBlock,
  CanonicalFilingSection,
  FilingChunk,
} from '../../openDart/document/canonicalFilingContracts.js';
import { PersistCanonicalFilingInput } from './contracts.js';
import { FilingPersistenceError } from './errors.js';

export interface FlattenedSection {
  readonly section: CanonicalFilingSection;
  readonly parentSectionId: string | null;
}

export function flattenSections(
  sections: readonly CanonicalFilingSection[],
): FlattenedSection[] {
  const flattened: FlattenedSection[] = [];
  const visit = (
    values: readonly CanonicalFilingSection[],
    parentSectionId: string | null,
  ): void => {
    for (const section of values) {
      flattened.push({ section, parentSectionId });
      visit(section.children, section.sectionId);
    }
  };
  visit(sections, null);
  return flattened.sort((left, right) => left.section.ordinal - right.section.ordinal);
}

function stableValue(value: unknown, inArray = false): unknown {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new FilingPersistenceError('FILING_PERSISTENCE_INVALID_INPUT', false);
    }
    return value;
  }
  if (value === undefined) {
    if (inArray) {
      throw new FilingPersistenceError('FILING_PERSISTENCE_INVALID_INPUT', false);
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(item => stableValue(item, true));
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new FilingPersistenceError('FILING_PERSISTENCE_INVALID_INPUT', false);
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([key, item]) => {
          const stable = stableValue(item);
          return stable === undefined ? [] : [[key, stable]];
        }),
    );
  }
  throw new FilingPersistenceError('FILING_PERSISTENCE_INVALID_INPUT', false);
}

export function serializeJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function hash(value: unknown): string {
  return createHash('sha256').update(serializeJson(value)).digest('hex');
}

function blockFingerprintValue(block: CanonicalFilingBlock): unknown {
  return {
    blockId: block.blockId,
    contentHash: block.contentHash,
    locator: block.locator,
    ordinal: block.ordinal,
    retrievalText: block.retrievalText,
    sectionId: block.sectionId,
    sectionPath: block.sectionPath,
    sourceText: block.sourceText,
    table: block.type === 'table' ? block.table : null,
    type: block.type,
  };
}

function chunkFingerprintValue(chunk: FilingChunk): unknown {
  return {
    blockTypes: chunk.blockTypes,
    chunkId: chunk.chunkId,
    chunkerVersion: chunk.chunkerVersion,
    contentHash: chunk.contentHash,
    locator: chunk.locator,
    ordinal: chunk.ordinal,
    parserVersion: chunk.parserVersion,
    provider: chunk.provider,
    receiptNumber: chunk.receiptNumber,
    retrievalText: chunk.retrievalText,
    schemaVersion: chunk.schemaVersion,
    sectionId: chunk.sectionId,
    sectionPath: chunk.sectionPath,
    sourceBlockIds: chunk.sourceBlockIds,
    sourceEntryHash: chunk.sourceEntryHash,
    sourceText: chunk.sourceText,
  };
}

export function calculatePersistenceFingerprints(
  input: PersistCanonicalFilingInput,
): {
  readonly canonicalFingerprint: string;
  readonly chunkFingerprint: string;
} {
  const sections = flattenSections(input.document.sections);
  const blocks = [...input.document.blocks].sort((left, right) => left.ordinal - right.ordinal);
  const chunks = [...input.chunks].sort((left, right) => left.ordinal - right.ordinal);
  return {
    canonicalFingerprint: hash({
      metadata: input.metadata,
      provider: input.document.provider,
      receiptNumber: input.document.receiptNumber,
      schemaName: input.document.schemaName,
      schemaVersion: input.document.schemaVersion,
      parserVersion: input.document.parserVersion,
      source: input.document.source,
      sourceTitle: input.document.sourceTitle,
      upstreamReportName: input.document.upstreamReportName,
      statistics: input.document.statistics,
      sections: sections.map(({ section, parentSectionId }) => ({
        blockIds: section.blockIds,
        depth: section.depth,
        ordinal: section.ordinal,
        parentSectionId,
        path: section.path,
        sectionId: section.sectionId,
        title: section.title,
      })),
      blocks: blocks.map(blockFingerprintValue),
    }),
    chunkFingerprint: hash(chunks.map(chunkFingerprintValue)),
  };
}
