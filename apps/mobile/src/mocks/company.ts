import { CompanyHealth, CompanyEvent, ProbabilityDistribution } from '../types';
export const mockHealth: CompanyHealth = {
  symbol: '000660', total: 74,
  confidence: { level: 'high', score: 0.86 },
  areas: [
    { key: 'growth', label: '성장성', score: 82, trend: { delta: 3, period: '1W' }, reason: 'HBM 출하량 QoQ +24%' },
    { key: 'profitability', label: '수익성', score: 76, trend: { delta: 1, period: '1W' }, reason: '메모리 ASP +11%' },
    { key: 'stability', label: '재무 안정성', score: 71, trend: { delta: 0, period: '1W' }, reason: '부채비율 유지' },
    { key: 'cashflow', label: '현금흐름', score: 58, trend: { delta: -4, period: '1W' }, reason: '재고자산 +34% · 원재료 선매입' },
    { key: 'valuation', label: '밸류에이션', score: 52, trend: { delta: -3, period: '1W' }, reason: 'P/B 2.1x 밴드 상단' },
    { key: 'flow', label: '수급', score: 79, trend: { delta: 5, period: '1W' }, reason: '외국인 순매수 +1.2조' },
    { key: 'momentum', label: '모멘텀', score: 81, trend: { delta: 2, period: '1W' }, reason: '' },
    { key: 'expectation', label: '시장 기대', score: 88, trend: { delta: 4, period: '1W' }, reason: '컨센서스 +18% (3M)' },
    { key: 'risk', label: '리스크', score: 61, trend: { delta: -2, period: '1W' }, reason: '경쟁사 양산 일정 단축' },
  ],
  upsideDrivers: ['실적 전망 상향', 'HBM 매출 비중 31%→38%'],
  downsideRisks: ['기대 선반영 구간', '경쟁 심화'],
  asOf: '2026-06-29T18:00:00+09:00',
};
export const mockCompanyEvents: CompanyEvent[] = [
  { id: 'ev-1', symbol: '000660', kind: 'news', date: '2026-06-27', direction: 'positive', severity: 'medium', certainty: 'reported',
    title: '엔비디아 HBM3E 12단 품질 인증 진행 보도', impactPath: '매출 경로: HBM 비중↑ → 영업이익률 개선',
    source: { id: 's-1', kind: 'news', title: '전자신문', date: '2026-06-27', caveat: '사실 미확인' } },
  { id: 'ev-2', symbol: '000660', kind: 'news', date: '2026-06-25', direction: 'negative', severity: 'high', certainty: 'confirmed',
    title: '경쟁사 HBM 양산 일정 6개월 단축 발표', impactPath: '점유율 경쟁 심화 위험',
    source: { id: 's-2', kind: 'news', title: 'Reuters', date: '2026-06-25' } },
];
export const mockDistribution: ProbabilityDistribution = {
  symbol: '000660', horizonDays: 20,
  outperformProb: 0.61, maxDrawdown: -0.14, medianRange: 0.09,
  bands: [ { p: 68, low: -0.06, high: 0.1 }, { p: 95, low: -0.14, high: 0.18 } ],
  eventMarkers: [ { date: '2026-07-24', label: '실적발표' } ],
  disclaimer: '확정적 예측이 아니라 현재 데이터 기반 확률 분포입니다.',
};
// 관계 지도: 노드/엣지 — NetworkGraph 컴포넌트 입력
export const mockNetwork = {
  center: { id: '000660', label: 'SK하이닉스' },
  nodes: [
    { id: 'nvda', label: '엔비디아', group: 'customer' },
    { id: 'customers2', label: '빅테크 고객', group: 'customer' },
    { id: 'supplier', label: '소재/장비', group: 'supplier' },
    { id: 'competitor', label: '경쟁 메모리', group: 'competitor' },
    { id: 'hbm', label: 'HBM', group: 'product' },
    { id: 'fx', label: '원/달러', group: 'macro' },
  ],
  edges: [
    { from: '000660', to: 'nvda', weight: 0.28, note: '매출 의존도 추정 28% · 경로: HBM 매출 → 영업이익', emphasized: true },
    { from: '000660', to: 'customers2', weight: 0.2 },
    { from: '000660', to: 'supplier', weight: 0.12 },
    { from: '000660', to: 'competitor', weight: 0.18 },
    { from: '000660', to: 'hbm', weight: 0.38 },
    { from: '000660', to: 'fx', weight: 0.41 },
  ],
};
