import { DisclosureQueryDto } from './contracts.js';
import { OpenDartError } from './errors.js';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CATEGORY_PATTERN = /^[A-J]$/;
const DETAIL_CATEGORY_PATTERN = /^[A-J]\d{3}$/;
const DAY_MS = 24 * 60 * 60_000;

function dateValue(value: string): number | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? timestamp
    : null;
}

function dateFromTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function getKstToday(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return formatter.format(now);
}

function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new OpenDartError('INVALID_DISCLOSURE_QUERY', 'disclosures', false);
  }
  return parsed;
}

export function parseDisclosureQuery(
  raw: Record<string, string | undefined>,
  now: Date = new Date(),
): DisclosureQueryDto {
  const to = raw.to ?? getKstToday(now);
  const toValue = dateValue(to);
  if (toValue == null) throw new OpenDartError('INVALID_DISCLOSURE_QUERY', 'disclosures', false);
  const from = raw.from ?? dateFromTimestamp(toValue - 89 * DAY_MS);
  const fromValue = dateValue(from);
  if (fromValue == null || fromValue > toValue || (toValue - fromValue) / DAY_MS > 365) {
    throw new OpenDartError('INVALID_DISCLOSURE_QUERY', 'disclosures', false);
  }
  if (raw.finalOnly != null && !['true', 'false'].includes(raw.finalOnly)) {
    throw new OpenDartError('INVALID_DISCLOSURE_QUERY', 'disclosures', false);
  }
  const category = raw.category?.trim().toUpperCase() || null;
  const detailCategory = raw.detailCategory?.trim().toUpperCase() || null;
  if (category && !CATEGORY_PATTERN.test(category)) {
    throw new OpenDartError('INVALID_DISCLOSURE_QUERY', 'disclosures', false);
  }
  if (detailCategory && !DETAIL_CATEGORY_PATTERN.test(detailCategory)) {
    throw new OpenDartError('INVALID_DISCLOSURE_QUERY', 'disclosures', false);
  }
  if (category && detailCategory && detailCategory[0] !== category) {
    throw new OpenDartError('INVALID_DISCLOSURE_QUERY', 'disclosures', false);
  }
  return {
    from,
    to,
    finalOnly: raw.finalOnly === 'true',
    category,
    detailCategory,
    page: integer(raw.page, 1, 1, 10_000),
    pageSize: integer(raw.pageSize, 20, 1, 100),
  };
}

export function compactDate(value: string): string {
  return value.replaceAll('-', '');
}
