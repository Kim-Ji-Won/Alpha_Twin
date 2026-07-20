import { StockCandleDto, StockQuoteDto } from '../contracts.js';
import { normalizeCandle, normalizeQuote } from '../normalizers.js';

export const PUBLIC_DATA_SOURCE = 'public-data-fsc';

export type PublicDataStockItem = Record<string, unknown>;

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid public data field: ${field}`);
  }
  return value.trim();
}

export function publicDataDate(value: unknown): string {
  const raw = requiredText(value, 'basDt');
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (!match) throw new Error('Invalid public data field: basDt');
  const [, year, month, day] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new Error('Invalid public data field: basDt');
  }
  return iso;
}

export function mapPublicDataQuote(item: PublicDataStockItem): StockQuoteDto {
  const quote = normalizeQuote({
    symbol: requiredText(item.srtnCd, 'srtnCd'),
    name: requiredText(item.itmsNm, 'itmsNm'),
    market: requiredText(item.mrktCtg, 'mrktCtg'),
    currency: 'KRW',
    price: item.clpr,
    change: item.vs,
    changePercent: item.fltRt,
    volume: item.trqu,
    tradingValue: item.trPrc,
    asOf: publicDataDate(item.basDt),
  }, PUBLIC_DATA_SOURCE);
  return {
    ...quote,
    dataMode: 'eod',
    priceAdjustment: 'unknown',
  };
}

export function mapPublicDataCandle(item: PublicDataStockItem): StockCandleDto {
  return normalizeCandle({
    symbol: requiredText(item.srtnCd, 'srtnCd'),
    date: publicDataDate(item.basDt),
    open: item.mkp,
    high: item.hipr,
    low: item.lopr,
    close: item.clpr,
    volume: item.trqu,
  }, PUBLIC_DATA_SOURCE);
}
