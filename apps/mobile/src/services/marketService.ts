// Screens must call services, never import mocks directly.
// Replace each method body with a real API call later — signatures stay stable.
import { AnomalySignal, CompanyEvent, MarketRegime, PortfolioImpactNotice } from '../types';
import { mockAnomalies, mockMarketEvents, mockNetFlow, mockPortfolioImpact, mockRegime, mockSectors } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));
export const marketService = {
  async getRegime(): Promise<MarketRegime> { await delay(); return mockRegime; },
  async getKeyEvents(): Promise<CompanyEvent[]> { await delay(); return mockMarketEvents; },
  async getNetFlow() { await delay(); return mockNetFlow; },
  async getSectors() { await delay(); return mockSectors; },
  async getPortfolioImpact(): Promise<PortfolioImpactNotice> { await delay(); return mockPortfolioImpact; },
  async getAnomalies(): Promise<AnomalySignal[]> { await delay(); return mockAnomalies; },
};
