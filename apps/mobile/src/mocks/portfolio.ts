import { Portfolio, PortfolioRisk } from '../types';
export const mockPortfolio: Portfolio = {
  totalValue: 84200000, readOnly: true,
  holdings: [
    { symbol: '000660', name: 'SK하이닉스', qty: 24, avgPrice: 168500, note: 'HBM 경쟁력 회복' },
    { symbol: '042700', name: '한미반도체', qty: 30, avgPrice: 118000 },
    { symbol: '010120', name: 'LS일렉트릭', qty: 12, avgPrice: 281000 },
    { symbol: '005380', name: '현대차', qty: 15, avgPrice: 251000 },
  ],
};
export const mockPortfolioRisk: PortfolioRisk = {
  headline: '보유 종목은 12개지만 핵심 위험 요인은 4개입니다',
  factors: [
    { label: '반도체 업황', exposure: 0.58, severity: 'high', linkedSymbols: ['000660','042700','005930'] },
    { label: 'AI 설비투자', exposure: 0.47, severity: 'high', linkedSymbols: ['000660','042700','010120'] },
    { label: '원/달러 환율', exposure: 0.41, severity: 'medium', linkedSymbols: ['000660','005380'] },
    { label: '미 기술주 수급', exposure: 0.35, severity: 'medium', linkedSymbols: ['000660','035420'] },
  ],
  allocation: [
    { label: '반도체', weight: 0.46 }, { label: '전력', weight: 0.22 }, { label: '자동차', weight: 0.14 },
    { label: '금융', weight: 0.10 }, { label: '기타', weight: 0.08 },
  ],
  concentrationHHI: 0.31, var95: -0.22, avgCorrelation: 0.68,
  suggestion: '환율 민감도 41%가 단일 변수 위험입니다. Scenario Lab에서 환율 -10% 시나리오를 실험해 보세요.',
  asOf: '2026-07-06T09:00:00+09:00',
};
