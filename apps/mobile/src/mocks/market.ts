import { AnomalySignal, CompanyEvent, MarketRegime, PortfolioImpactNotice } from '../types';
export const mockRegime: MarketRegime = {
  label: '저변동성 상승 국면',
  probability: 0.74,
  probabilityTrend: { delta: -0.14, period: '3D' }, // 88% → 74%
  riskLevel: 'medium',
  sentiment: '위험선호 유지',
  volatility: '3일 연속 상승',
  asOf: '2026-07-06T08:30:00+09:00',
  // 프레임 01 히어로/지표 표시 필드
  en: 'Low-Volatility Uptrend · 신뢰도 안정',
  summary:
    '지수는 완만하게 상승하고 변동성은 낮게 유지되고 있습니다. 외국인 순매수가 7일째 이어지며 위험선호가 우세하지만, 일부 대형주에 수급이 집중되어 있습니다.',
  confidence: 0.81,
  riskNote: 'VIX 14.2 ▼',
  sentimentTrend: '▲ 전일 +4',
  volatilityNote: '20D 11.3%',
  indexLabel: 'KOSPI 2,894',
};
// 프레임 01 — 내 포트폴리오 영향 (LIVE 알림 패널)
export const mockPortfolioImpact: PortfolioImpactNotice = {
  headline:
    '보유 종목 중 3개가 오늘 원/달러 환율 하락(−1.2%)에 노출되어 있습니다. 수출 비중이 높은 종목의 단기 영업이익 추정에 부정적일 수 있습니다.',
  // 디자인 프레임 01: '3개' ink bold · 환율 하락 warn bold
  headlineHighlights: [
    { text: '3개', tone: 'strong' },
    { text: '원/달러 환율 하락(−1.2%)', tone: 'warning' },
  ],
  symbols: [
    { symbol: '000660', name: 'SK하이닉스' },
    { symbol: '006400', name: '삼성SDI' },
    { symbol: '005380', name: '현대차' },
  ],
};
// 프레임 01 — AI 이상 탐지 (접힘 요약: 1건 · 3.2σ)
export const mockAnomalies: AnomalySignal[] = [
  {
    id: 'an-1',
    symbol: '042700',
    name: '한미반도체',
    sigma: 3.2,
    note: '거래량이 20일 평균 대비 3.2σ 급증. 주가 +34% 대비 실적 전망 변화 없음 — Narrative Gap 확대.',
  },
];
export const mockMarketEvents: CompanyEvent[] = [
  { id: 'ev-m1', symbol: 'NVDA', relatedSymbol: '000660', kind: 'earnings', date: '2026-07-06T08:30:00+09:00', direction: 'positive', severity: 'high', certainty: 'confirmed',
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
