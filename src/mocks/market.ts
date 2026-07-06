import { MarketRegime, CompanyEvent } from '../types';
export const mockRegime: MarketRegime = {
  label: '저변동성 상승 국면',
  probability: 0.74,
  probabilityTrend: { delta: -0.14, period: '3D' }, // 88% → 74%
  riskLevel: 'medium',
  sentiment: '위험선호 유지',
  volatility: '3일 연속 상승',
  asOf: '2026-07-06T08:30:00+09:00',
};
export const mockMarketEvents: CompanyEvent[] = [
  { id: 'ev-m1', symbol: 'NVDA', kind: 'earnings', date: '2026-07-06T08:30:00+09:00', direction: 'positive', severity: 'high', certainty: 'confirmed',
    title: '엔비디아 데이터센터 가이던스 상향', impactPath: 'HBM 공급사 전반 긍정 파급 · AI 설비투자 사이클 연장',
    source: { id: 's-m1', kind: 'news', title: 'Reuters', date: '2026-07-06' } },
  { id: 'ev-m2', symbol: 'MACRO', kind: 'macro', date: '2026-07-06T06:00:00+09:00', direction: 'negative', severity: 'medium', certainty: 'confirmed',
    title: '미 10년물 금리 4.41%로 상승', impactPath: '성장주 밸류에이션 부담 · 금리 민감 섹터 변동성 확대',
    source: { id: 's-m2', kind: 'news', title: 'Bloomberg', date: '2026-07-06' } },
];
export const mockNetFlow = [
  { label: '외국인', value: 8420, direction: 'positive' as const },
  { label: '기관', value: -2710, direction: 'negative' as const },
  { label: '개인', value: -5640, direction: 'negative' as const },
];
export const mockSectors = {
  strong: [ { name: '반도체', pct: 2.8 }, { name: '2차전지', pct: 1.9 }, { name: '전력기기', pct: 1.4 } ],
  weak: [ { name: '바이오', pct: -1.7 }, { name: '유통', pct: -1.1 }, { name: '건설', pct: -0.8 } ],
};
