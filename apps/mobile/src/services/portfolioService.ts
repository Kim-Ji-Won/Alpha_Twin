import { Portfolio, PortfolioRisk, PortfolioHolding } from '../types';
import { mockPortfolio, mockPortfolioRisk } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));
export const portfolioService = {
  async get(): Promise<Portfolio> { await delay(); return mockPortfolio; },
  async getRisk(): Promise<PortfolioRisk> { await delay(); return mockPortfolioRisk; },
  async addHolding(h: PortfolioHolding): Promise<void> { await delay(); },
  async updateHolding(h: PortfolioHolding): Promise<void> { await delay(); },
  async removeHolding(symbol: string): Promise<void> { await delay(); },
};
