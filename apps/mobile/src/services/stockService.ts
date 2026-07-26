import { CompanyHealth, CompanyEvent, CompanyMarketData, CompanyNetwork, ProbabilityDistribution, Stock } from '../types';
import { companyDataFor, mockCompanyMarketData, mockStocks } from '../mocks';
import { alphaTwinApi } from './alphaTwinApi';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));
export const stockService = {
  async search(query: string): Promise<Stock[]> {
    await delay();
    const q = query.trim();
    if (!q) return mockStocks;
    return mockStocks.filter(s => s.name.includes(q) || s.symbol.includes(q) || s.sector.includes(q));
  },
  async getWatchlist(): Promise<Stock[]> { await delay(); return mockStocks; },
  // 종목 기본 정보(현재가·등락) — Company Twin 헤더
  async getQuote(symbol: string): Promise<Stock | null> {
    await delay(200);
    return mockStocks.find(s => s.symbol === symbol) ?? null;
  },
  // P3-B 수직 기능: ALPHA TWIN API 시세/일봉 → 실패 시 모바일 Mock fallback.
  async getCompanyMarketData(symbol: string, signal?: AbortSignal): Promise<CompanyMarketData> {
    const fallback = mockCompanyMarketData(symbol);
    try {
      const summary = await alphaTwinApi.getStockSummary(symbol, signal);
      const partial = summary.candles.length === 0;
      const isConfirmedPublicData = summary.metadata.dataMode === 'eod'
        || summary.metadata.source.includes('public-data-fsc');
      const mode = summary.metadata.stale
        ? 'stale'
        : partial
          ? 'partial'
          : summary.metadata.fallback
            ? 'fallback'
            : isConfirmedPublicData
              ? 'confirmed'
              : 'live';
      return {
        quote: {
          symbol: summary.quote.symbol,
          name: summary.quote.name,
          sector: summary.quote.sector ?? '',
          price: summary.quote.price,
          changePct: summary.quote.changePercent,
          healthScore: 0,
          market: summary.quote.market,
          currency: summary.quote.currency,
          change: summary.quote.change,
          volume: summary.quote.volume,
          tradingValue: summary.quote.tradingValue,
          asOf: summary.quote.asOf,
          source: summary.quote.source,
          stale: summary.quote.stale,
          fallback: summary.quote.fallback,
          dataMode: summary.quote.dataMode ?? summary.metadata.dataMode,
          priceAdjustment: summary.quote.priceAdjustment ?? summary.metadata.priceAdjustment,
        },
        candles: summary.candles,
        metadata: { ...summary.metadata, partial, mode },
      };
    } catch {
      if (signal?.aborted) throw new Error('REQUEST_ABORTED');
      return fallback;
    }
  },
  // P1 감사 #5 수정: 종목별 키 구조(companyDataFor)에서 조회
  async getHealth(symbol: string): Promise<CompanyHealth | null> { await delay(); return companyDataFor(symbol)?.health ?? null; },
  async getEvents(symbol: string): Promise<CompanyEvent[] | null> { await delay(); return companyDataFor(symbol)?.events ?? null; },
  async getDistribution(symbol: string): Promise<ProbabilityDistribution | null> { await delay(); return companyDataFor(symbol)?.distribution ?? null; },
  async getNetwork(symbol: string): Promise<CompanyNetwork | null> { await delay(); return companyDataFor(symbol)?.network ?? null; },
};
