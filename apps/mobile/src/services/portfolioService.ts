import { Portfolio, PortfolioRisk, PortfolioHolding } from '../types';
import { mockPortfolio, mockPortfolioRisk } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));
export const portfolioService = {
  async get(): Promise<Portfolio> { await delay(); return mockPortfolio; },
  async getRisk(): Promise<PortfolioRisk> {
    await delay();
    // P1 감사 #1 수정: headline의 보유 종목 수를 실제 보유 데이터에서 계산
    return {
      ...mockPortfolioRisk,
      headline: `보유 종목은 ${mockPortfolio.holdings.length}개지만 핵심 위험 요인은 ${mockPortfolioRisk.factors.length}개입니다`,
    };
  },
  async addHolding(h: PortfolioHolding): Promise<void> { await delay(); },
  async updateHolding(h: PortfolioHolding): Promise<void> { await delay(); },
  async removeHolding(symbol: string): Promise<void> { await delay(); },
};
