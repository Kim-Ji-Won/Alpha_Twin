import type { FilingChunk } from '../../src/openDart/document/canonicalFilingContracts.js';
import { DenseEvaluationError } from './contracts.js';
import { parsePendingLocator } from './pendingReview.js';

type CanonicalLocator = FilingChunk['locator'];
export type EvaluationLocator = Readonly<Record<string, string | number | boolean>>;
const RANGE_FIELDS = [
  ['rowRange', 'rowStart', 'rowEnd'],
  ['repeatedHeaderRowRange', 'repeatedHeaderRowStart', 'repeatedHeaderRowEnd'],
] as const;
const CANONICAL_KEYS = ['entryName', 'firstBlockOrdinal', 'lastBlockOrdinal', 'tableId',
  'continuation', 'continuationIndex'];
const invalid = (): never => { throw new DenseEvaluationError('DATASET_LOCATOR_INVALID'); };
const ordinal = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

export function parseEvaluationLocator(value: unknown): EvaluationLocator {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length > 12) return invalid();
  for (const item of Object.values(v)) {
    if (!['string', 'number', 'boolean'].includes(typeof item)
      || (typeof item === 'string' && item.length > 256)
      || (typeof item === 'number' && !Number.isFinite(item))) return invalid();
  }
  for (const [tuple, start, end] of RANGE_FIELDS) {
    // Tuple keys are never accepted, including stringified arrays or legacy range strings.
    if (Object.hasOwn(v, tuple)) return invalid();
    if (Object.hasOwn(v, start) || Object.hasOwn(v, end)) {
      if (!Object.hasOwn(v, start) || !Object.hasOwn(v, end)
        || !ordinal(v[start]) || !ordinal(v[end]) || v[start] > v[end]
        || !Object.hasOwn(v, 'tableId') || typeof v.tableId !== 'string' || !v.tableId.trim()) return invalid();
    }
  }
  if (Object.hasOwn(v, 'tableId') && (typeof v.tableId !== 'string' || !v.tableId.trim())) return invalid();
  if (Object.hasOwn(v, 'entryName') && (typeof v.entryName !== 'string' || !v.entryName.trim())) return invalid();
  if (Object.hasOwn(v, 'firstBlockOrdinal') || Object.hasOwn(v, 'lastBlockOrdinal')) {
    if (!Object.hasOwn(v, 'firstBlockOrdinal') || !Object.hasOwn(v, 'lastBlockOrdinal')
      || !ordinal(v.firstBlockOrdinal) || !ordinal(v.lastBlockOrdinal)
      || v.firstBlockOrdinal > v.lastBlockOrdinal) return invalid();
  }
  if (Object.hasOwn(v, 'continuation') && typeof v.continuation !== 'boolean') return invalid();
  if (Object.hasOwn(v, 'continuationIndex') && !ordinal(v.continuationIndex)) return invalid();
  return { ...v } as EvaluationLocator;
}

function canonical(value: unknown): CanonicalLocator {
  try { return parsePendingLocator(value); } catch { return invalid(); }
}

export function canonicalToEvaluationLocator(value: CanonicalLocator): EvaluationLocator {
  const parsed = canonical(value);
  const { rowRange, repeatedHeaderRowRange, ...scalars } = parsed;
  return parseEvaluationLocator({ ...scalars,
    ...(rowRange === undefined ? {} : { rowStart: rowRange[0], rowEnd: rowRange[1] }),
    ...(repeatedHeaderRowRange === undefined ? {} : {
      repeatedHeaderRowStart: repeatedHeaderRowRange[0], repeatedHeaderRowEnd: repeatedHeaderRowRange[1],
    }),
  });
}

// Only canonical-shaped locators are reconstructable; legacy scalar locators remain readable.
export function evaluationToCanonicalLocator(value: EvaluationLocator): CanonicalLocator {
  const parsed = parseEvaluationLocator(value);
  const allowed = new Set([...CANONICAL_KEYS, ...RANGE_FIELDS.flatMap(([, start, end]) => [start, end])]);
  if (Object.keys(parsed).some(key => !allowed.has(key))) return invalid();
  const result: Record<string, unknown> = {};
  for (const key of CANONICAL_KEYS) if (Object.hasOwn(parsed, key)) result[key] = parsed[key];
  for (const [tuple, start, end] of RANGE_FIELDS) {
    if (Object.hasOwn(parsed, start)) result[tuple] = [parsed[start], parsed[end]];
  }
  return canonical(result);
}
