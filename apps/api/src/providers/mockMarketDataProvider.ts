import { CandleRange, StockCandleDto, StockQuoteDto } from '../contracts.js';
import { normalizeCandle, normalizeQuote } from '../normalizers.js';
import { MarketDataProvider } from './marketDataProvider.js';

const STOCKS: Record<string, { name: string; sector: string; price: number; change: number; changePercent: number }> = {
  '000660': { name: 'SK하이닉스', sector: '반도체', price: 178400, change: 4079, changePercent: 2.34 },
  '005930': { name: '삼성전자', sector: '반도체', price: 84200, change: 594, changePercent: 0.71 },
};

const RANGE_DAYS: Record<CandleRange, number> = { '1m': 22, '3m': 66, '6m': 132, '1y': 252 };

export class MockMarketDataProvider implements MarketDataProvider {
  readonly id = 'alpha-twin-mock';
  readonly isFallback = true;
  readonly dataMode = 'mock' as const;
  readonly priceAdjustment = 'unknown' as const;

  async getQuote(symbol: string): Promise<StockQuoteDto> {
    const stock = STOCKS[symbol];
    if (!stock) throw new Error(`Mock quote is not available for symbol ${symbol}`);
    const quote = normalizeQuote({
      symbol,
      name: stock.name,
      market: 'KOSPI',
      sector: stock.sector,
      currency: 'KRW',
      price: String(stock.price),
      change: String(stock.change),
      changePercent: String(stock.changePercent),
      volume: '3,812,450',
      tradingValue: '684,291,080,000',
      asOf: new Date().toISOString(),
    }, this.id, true);
    return { ...quote, dataMode: this.dataMode, priceAdjustment: this.priceAdjustment };
  }

  async getDailyCandles(symbol: string, range: CandleRange): Promise<StockCandleDto[]> {
    const stock = STOCKS[symbol];
    if (!stock) throw new Error(`Mock candles are not available for symbol ${symbol}`);
    const count = RANGE_DAYS[range];
    const end = new Date();
    const terminalWave = Math.sin((count - 1) / 3.2) * 0.02;
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(end);
      date.setUTCDate(end.getUTCDate() - (count - index - 1));
      const progress = index / Math.max(count - 1, 1);
      const wave = (progress - 1) * 0.06 + Math.sin(index / 3.2) * 0.02 - terminalWave * progress;
      const close = Math.round(stock.price * (1 + wave) / 100) * 100;
      const open = Math.round(close * (1 - Math.sin(index * 1.7) * 0.008) / 100) * 100;
      return normalizeCandle({
        symbol,
        date: date.toISOString().slice(0, 10),
        open: String(open),
        high: String(Math.max(open, close) + 1200),
        low: String(Math.min(open, close) - 1100),
        close: String(close),
        volume: String(2_600_000 + index * 37_000),
      }, this.id);
    });
  }
}
