import { CompanyHealth, CompanyEvent, CompanyNetwork, ProbabilityDistribution, Stock } from '../types';
import { companyDataFor, mockStocks } from '../mocks';
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
  // P1 감사 #5 수정: 종목별 키 구조(companyDataFor)에서 조회
  async getHealth(symbol: string): Promise<CompanyHealth> { await delay(); return companyDataFor(symbol).health; },
  async getEvents(symbol: string): Promise<CompanyEvent[]> { await delay(); return companyDataFor(symbol).events; },
  async getDistribution(symbol: string): Promise<ProbabilityDistribution> { await delay(); return companyDataFor(symbol).distribution; },
  async getNetwork(symbol: string): Promise<CompanyNetwork> { await delay(); return companyDataFor(symbol).network; },
};
