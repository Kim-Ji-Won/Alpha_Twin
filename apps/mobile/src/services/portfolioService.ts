import AsyncStorage from '@react-native-async-storage/async-storage';
import { Portfolio, PortfolioHolding, PortfolioRisk } from '../types';
import { mockPortfolio, mockPortfolioRisk, mockStocks } from '../mocks';
const delay = (ms = 350) => new Promise(r => setTimeout(r, ms));

// P2: 보유 종목은 AsyncStorage에 저장 (실제 계좌 연결 없음 — 분석 전용 기록).
// X-Ray의 종목 수·평가액·배분은 저장된 보유 내역에서 계산한다.
const KEY = '@alpha-twin/portfolio-holdings:v1';

async function readHoldings(): Promise<PortfolioHolding[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as PortfolioHolding[];
  } catch {}
  return mockPortfolio.holdings;
}

async function writeHoldings(holdings: PortfolioHolding[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(holdings));
  } catch {}
}

function currentPrice(symbol: string, fallback: number): number {
  return mockStocks.find(s => s.symbol === symbol)?.price ?? fallback;
}

function sectorOf(symbol: string): string {
  return mockStocks.find(s => s.symbol === symbol)?.sector ?? '기타';
}

export function holdingValue(h: PortfolioHolding): number {
  return h.qty * currentPrice(h.symbol, h.avgPrice);
}

export const portfolioService = {
  async get(): Promise<Portfolio> {
    await delay();
    const holdings = await readHoldings();
    const totalValue = holdings.reduce((sum, h) => sum + holdingValue(h), 0);
    return { ...mockPortfolio, holdings, totalValue };
  },
  async getRisk(): Promise<PortfolioRisk> {
    await delay();
    const holdings = await readHoldings();
    // P1 감사 #1 유지: headline 숫자는 항상 실제 보유 수에서 계산
    const headline = `보유 종목은 ${holdings.length}개지만 핵심 위험 요인은 ${mockPortfolioRisk.factors.length}개입니다`;
    // 산업별 비중 — 보유 평가액 기준으로 재계산 (상위 4개 + 기타)
    const total = holdings.reduce((sum, h) => sum + holdingValue(h), 0);
    const bySector = new Map<string, number>();
    for (const h of holdings) {
      const sector = sectorOf(h.symbol);
      bySector.set(sector, (bySector.get(sector) ?? 0) + holdingValue(h));
    }
    const sorted = [...bySector.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 4).map(([label, v]) => ({ label, weight: total > 0 ? v / total : 0 }));
    const rest = sorted.slice(4).reduce((sum, [, v]) => sum + v, 0);
    const allocation =
      total > 0
        ? rest > 0
          ? [...top, { label: '기타', weight: rest / total }]
          : top
        : [];
    // 위험 요인 연결 종목도 현재 보유분으로 필터 (빈 배열이면 요인 유지 — 잠재 위험 안내)
    const held = new Set(holdings.map(h => h.symbol));
    const factors = mockPortfolioRisk.factors.map(f => ({
      ...f,
      linkedSymbols: f.linkedSymbols.filter(s => held.has(s)),
    }));
    return { ...mockPortfolioRisk, headline, allocation, factors };
  },
  async addHolding(h: PortfolioHolding): Promise<void> {
    await delay(200);
    const cur = await readHoldings();
    await writeHoldings([...cur.filter(x => x.symbol !== h.symbol), h]);
  },
  async updateHolding(h: PortfolioHolding): Promise<void> {
    await delay(200);
    const cur = await readHoldings();
    await writeHoldings(cur.map(x => (x.symbol === h.symbol ? h : x)));
  },
  async removeHolding(symbol: string): Promise<void> {
    await delay(200);
    const cur = await readHoldings();
    await writeHoldings(cur.filter(x => x.symbol !== symbol));
  },
  async getHolding(symbol: string): Promise<PortfolioHolding | null> {
    await delay(150);
    return (await readHoldings()).find(h => h.symbol === symbol) ?? null;
  },
};
