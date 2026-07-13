// P2 — Discover (프레임 08). 검색은 Mock Stock Service 재사용.
import { DiscoverSignal, IndustryTwin, NarrativeGapItem, Stock } from '../types';
import {
  discoverNaturalQueries,
  mockDiscoverSignals,
  mockIndustryTwins,
  mockNarrativeGaps,
  mockStocks,
} from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));

export const discoverService = {
  naturalQueries: discoverNaturalQueries,
  async getSignals(): Promise<DiscoverSignal[]> { await delay(); return mockDiscoverSignals; },
  async getIndustries(): Promise<IndustryTwin[]> { await delay(); return mockIndustryTwins; },
  async getNarrativeGaps(): Promise<NarrativeGapItem[]> { await delay(); return mockNarrativeGaps; },
  // 종목명·코드·산업 검색 (자연어 칩은 P3에서 실제 AI 탐색으로 교체)
  async search(query: string): Promise<Stock[]> {
    await delay(250);
    const q = query.trim();
    if (!q) return [];
    return mockStocks.filter(s => s.name.includes(q) || s.symbol.includes(q) || s.sector.includes(q));
  },
};
