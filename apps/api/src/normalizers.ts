import { StockCandleDto, StockQuoteDto } from './contracts.js';

type UnknownRecord = Record<string, unknown>;

function requiredText(input: UnknownRecord, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required field: ${key}`);
  return value.trim();
}

function optionalText(input: UnknownRecord, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function finiteNumber(value: unknown, field: string): number {
  const normalized = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
  const parsed = typeof normalized === 'number'
    ? normalized
    : typeof normalized === 'string' && normalized
      ? Number(normalized)
      : NaN;
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric field: ${field}`);
  return parsed;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  return value == null || value === '' ? undefined : finiteNumber(value, field);
}

export function normalizeQuote(input: UnknownRecord, source: string, fallback = false): StockQuoteDto {
  return {
    symbol: requiredText(input, 'symbol'),
    name: requiredText(input, 'name'),
    market: requiredText(input, 'market'),
    sector: optionalText(input, 'sector'),
    currency: requiredText(input, 'currency'),
    price: finiteNumber(input.price, 'price'),
    change: finiteNumber(input.change, 'change'),
    changePercent: finiteNumber(input.changePercent, 'changePercent'),
    volume: optionalNumber(input.volume, 'volume'),
    tradingValue: optionalNumber(input.tradingValue, 'tradingValue'),
    asOf: requiredText(input, 'asOf'),
    source,
    stale: false,
    fallback,
  };
}

export function normalizeCandle(input: UnknownRecord, source: string): StockCandleDto {
  return {
    symbol: requiredText(input, 'symbol'),
    date: requiredText(input, 'date'),
    open: finiteNumber(input.open, 'open'),
    high: finiteNumber(input.high, 'high'),
    low: finiteNumber(input.low, 'low'),
    close: finiteNumber(input.close, 'close'),
    volume: finiteNumber(input.volume, 'volume'),
    source,
  };
}
