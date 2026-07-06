import { Stock, CompanyHealth, CompanyEvent, ProbabilityDistribution } from '../types';
import { mockStocks, mockHealth, mockCompanyEvents, mockDistribution, mockNetwork } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));
export const stockService = {
  async search(query: string): Promise<Stock[]> {
    await delay();
    const q = query.trim();
    if (!q) return mockStocks;
    return mockStocks.filter(s => s.name.includes(q) || s.symbol.includes(q) || s.sector.includes(q));
  },
  async getWatchlist(): Promise<Stock[]> { await delay(); return mockStocks; },
  async getHealth(symbol: string): Promise<CompanyHealth> { await delay(); return { ...mockHealth, symbol }; },
  async getEvents(symbol: string): Promise<CompanyEvent[]> { await delay(); return mockCompanyEvents; },
  async getDistribution(symbol: string): Promise<ProbabilityDistribution> { await delay(); return { ...mockDistribution, symbol }; },
  async getNetwork(symbol: string) { await delay(); return mockNetwork; },
};
