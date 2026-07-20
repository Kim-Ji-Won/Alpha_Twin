const KST_OFFSET_MS = 9 * 60 * 60_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(value: string): Date {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error('Invalid date-only value');
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.toISOString().slice(0, 10) !== value) throw new Error('Invalid date-only value');
  return date;
}

export function getKstDateString(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function subtractCalendarMonths(value: string, months: number): string {
  const date = parseDateOnly(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

export function calculateEodQueryRange(now: Date, months: number): { begin: string; end: string } {
  const today = getKstDateString(now);
  return {
    begin: subtractCalendarMonths(today, months),
    end: addCalendarDays(today, 1),
  };
}

export function isWeekend(value: string): boolean {
  const day = parseDateOnly(value).getUTCDay();
  return day === 0 || day === 6;
}

export function businessDaysBetween(from: string, to: string, limit = 366): number {
  let cursor = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (cursor > end) return 0;
  let count = 0;
  let steps = 0;
  while (cursor < end && steps < limit) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60_000);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
    steps += 1;
  }
  return count;
}

export function classifyEodFreshness(asOf: string, now: Date): 'recent' | 'delayed' | 'unknown' {
  try {
    // Public data is normally T+1. Weekends and holidays are intentionally tolerated.
    return businessDaysBetween(asOf, getKstDateString(now), 31) <= 4 ? 'recent' : 'delayed';
  } catch {
    return 'unknown';
  }
}
