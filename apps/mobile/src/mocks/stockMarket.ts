import { CompanyMarketData, Stock, StockCandle } from '../types';
import { mockStocks } from './stocks';

const FALLBACK_AS_OF = '2026-07-06T09:00:00+09:00';

function fallbackCandles(stock: Stock): StockCandle[] {
  const count = 22;
  const end = new Date('2026-07-06T00:00:00Z');
  const terminalWave = Math.sin((count - 1) / 3.2) * 0.02;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (count - index - 1));
    const progress = index / (count - 1);
    const wave = (progress - 1) * 0.06 + Math.sin(index / 3.2) * 0.02 - terminalWave * progress;
    const close = Math.round(stock.price * (1 + wave) / 100) * 100;
    const open = Math.round(close * (1 - Math.sin(index * 1.7) * 0.008) / 100) * 100;
    return {
      symbol: stock.symbol,
      date: date.toISOString().slice(0, 10),
      open,
      high: Math.max(open, close) + 1200,
      low: Math.min(open, close) - 1100,
      close,
      volume: 2_600_000 + index * 37_000,
      source: 'mobile-mock',
    };
  });
}

export function mockCompanyMarketData(symbol: string): CompanyMarketData {
  const stock = mockStocks.find(item => item.symbol === symbol) ?? null;
  return {
    quote: stock ? {
      ...stock,
      market: 'KOSPI',
      currency: 'KRW',
      change: Math.round(stock.price - stock.price / (1 + stock.changePct / 100)),
      volume: 3_812_450,
      tradingValue: 684_291_080_000,
      asOf: FALLBACK_AS_OF,
      source: 'mobile-mock',
      stale: false,
      fallback: true,
    } : null,
    candles: stock ? fallbackCandles(stock) : [],
    metadata: {
      asOf: FALLBACK_AS_OF,
      source: 'mobile-mock',
      stale: false,
      fallback: true,
      partial: false,
      mode: 'fallback',
    },
  };
}
