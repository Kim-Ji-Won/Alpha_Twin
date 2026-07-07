import {
  CompanyEvent,
  CompanyHealth,
  CompanyNetwork,
  ProbabilityDistribution,
} from '../types';
import { mockStocks } from './stocks';

// ── SK하이닉스(000660): 디자인 프레임 02와 1:1인 대표 데이터 ──────────────
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
    // 빈 reason 수정 (P1 감사 #3) — 디자인 프레임 02 변화 원인 문구와 일치
    { key: 'momentum', label: '모멘텀', score: 81, trend: { delta: 2, period: '1W' }, reason: '외국인 순매수·HBM 뉴스 빈도 증가' },
    { key: 'expectation', label: '시장 기대', score: 88, trend: { delta: 4, period: '1W' }, reason: '컨센서스 +18% (3M)' },
    { key: 'risk', label: '리스크', score: 61, trend: { delta: -2, period: '1W' }, reason: '경쟁사 양산 일정 단축' },
  ],
  upsideDrivers: ['HBM3E 12단 고객사 인증 임박', '메모리 ASP 반등'],
  downsideRisks: ['경쟁사 진입', 'AI capex 둔화 시 수요 충격'],
  asOf: '2026-06-29T18:00:00+09:00',
  totalTrend: { delta: 3, period: '7D' },
  riskLevel: 'medium',
  riskNote: '변동성 ↑',
  summary: '현재 주가는 실적 전망 상향이 주도하고 있으나, 일부는 AI 기대감이 선반영된 상태입니다.',
  changeNote: '모멘텀 점수가 외국인 순매수와 HBM 뉴스 빈도 증가로 +9 상승. 밸류에이션은 주가 상승으로 부담 구간 진입.',
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
export const mockNetwork: CompanyNetwork = {
  center: { id: '000660', label: 'SK하이닉스' },
  nodes: [
    { id: 'nvda', label: '엔비디아', group: 'customer', sub: '핵심 고객' },
    { id: 'customers2', label: '빅테크 고객', group: 'customer', sub: '고객' },
    { id: 'supplier', label: '소재/장비', group: 'supplier', sub: '공급' },
    { id: 'competitor', label: '경쟁 메모리', group: 'competitor', sub: '경쟁' },
    { id: 'hbm', label: 'HBM', group: 'product', sub: '제품' },
    { id: 'fx', label: '원/달러', group: 'macro', sub: '거시' },
  ],
  edges: [
    { from: '000660', to: 'nvda', weight: 0.28, note: '매출 의존도 추정 28% · 경로: HBM 매출 → 영업이익', emphasized: true },
    { from: '000660', to: 'customers2', weight: 0.2, note: '빅테크 매출 비중 추정 20%' },
    { from: '000660', to: 'supplier', weight: 0.12, note: '소재·장비 조달 의존 12%' },
    { from: '000660', to: 'competitor', weight: 0.18, note: '점유율 경쟁 강도 18% · HBM 양산 경쟁' },
    { from: '000660', to: 'hbm', weight: 0.38, note: 'HBM 매출 비중 38% · 핵심 제품' },
    { from: '000660', to: 'fx', weight: 0.41, note: '환율 민감도 41% · 수출 매출 환산' },
  ],
};

// ── 종목별 기업 데이터 (P1 감사 #5: 어떤 종목이든 동일 데이터 반환 → 키 구조로 수정) ──
export interface CompanyData {
  health: CompanyHealth;
  events: CompanyEvent[];
  distribution: ProbabilityDistribution;
  network: CompanyNetwork;
}

const companyData: Record<string, CompanyData> = {
  '000660': {
    health: mockHealth,
    events: mockCompanyEvents,
    distribution: mockDistribution,
    network: mockNetwork,
  },
};

// 등록되지 않은 종목은 종목 기본 정보(mockStocks)로부터 결정적으로 파생 —
// 새 종목 추가 시 companyData에 항목만 넣으면 됨 (확장 가능 구조).
function derivedCompanyData(symbol: string): CompanyData {
  const stock = mockStocks.find(s => s.symbol === symbol);
  const name = stock?.name ?? symbol;
  const base = stock?.healthScore ?? 60;
  const seed = [...symbol].reduce((a, c) => a + c.charCodeAt(0), 0);
  const vary = (i: number, range = 14) => {
    const v = base + (((seed >> i) % (range * 2 + 1)) - range);
    return Math.max(20, Math.min(95, v));
  };
  return {
    health: {
      symbol,
      total: base,
      confidence: { level: 'medium', score: 0.68 },
      areas: [
        { key: 'growth', label: '성장성', score: vary(1), trend: { delta: (seed % 5) - 2, period: '1W' }, reason: `${name} 매출 성장률 컨센서스 반영` },
        { key: 'profitability', label: '수익성', score: vary(2), trend: { delta: (seed % 3) - 1, period: '1W' }, reason: '영업이익률 추정 반영' },
        { key: 'stability', label: '재무 안정성', score: vary(3), trend: { delta: 0, period: '1W' }, reason: '부채비율 유지' },
        { key: 'valuation', label: '밸류에이션', score: vary(4), trend: { delta: ((seed >> 2) % 3) - 1, period: '1W' }, reason: '섹터 평균 대비 밸류에이션 밴드' },
        { key: 'flow', label: '수급', score: vary(5), trend: { delta: ((seed >> 3) % 5) - 2, period: '1W' }, reason: '외국인·기관 순매수 추세 반영' },
        { key: 'momentum', label: '모멘텀', score: vary(6), trend: { delta: ((seed >> 4) % 3) - 1, period: '1W' }, reason: '가격 추세·뉴스 빈도 반영' },
      ],
      upsideDrivers: [`${name} 주요 사업 수주 확대`, '업황 회복 기대'],
      downsideRisks: ['수요 둔화 가능성', '경쟁 심화'],
      asOf: '2026-06-29T18:00:00+09:00',
      totalTrend: { delta: (seed % 7) - 3, period: '7D' },
      riskLevel: base >= 70 ? 'low' : base >= 55 ? 'medium' : 'high',
      riskNote: base >= 55 ? '변동성 보통' : '변동성 ↑',
      summary: `${name}의 상태 점수는 최근 수급과 업황 컨센서스를 반영해 ${base}점입니다. 공개 데이터 기반 추정치입니다.`,
      changeNote: '수급·모멘텀 영역 변화가 최근 점수 변동의 주요 원인입니다.',
    },
    events: [
      { id: `ev-${symbol}-1`, symbol, kind: 'news', date: '2026-06-26', direction: (seed % 2 === 0 ? 'positive' : 'negative'), severity: 'medium', certainty: 'reported',
        title: `${name} 관련 업황 보도`, impactPath: '섹터 수급 경로: 업황 전망 → 상태 점수',
        source: { id: `s-${symbol}-1`, kind: 'news', title: '연합인포맥스', date: '2026-06-26', caveat: '사실 미확인' } },
    ],
    distribution: {
      symbol, horizonDays: 20,
      outperformProb: Math.round((0.4 + (base / 250)) * 100) / 100,
      maxDrawdown: -0.1 - (seed % 8) / 100,
      medianRange: 0.07 + (seed % 5) / 100,
      bands: [ { p: 68, low: -0.05 - (seed % 4) / 100, high: 0.07 + (seed % 5) / 100 }, { p: 95, low: -0.11 - (seed % 6) / 100, high: 0.14 + (seed % 6) / 100 } ],
      eventMarkers: [ { date: '2026-07-28', label: '실적발표' } ],
      disclaimer: '확정적 예측이 아니라 현재 데이터 기반 확률 분포입니다.',
    },
    network: {
      center: { id: symbol, label: name },
      nodes: [
        { id: 'cust', label: '주요 고객', group: 'customer', sub: '고객' },
        { id: 'sup', label: '공급망', group: 'supplier', sub: '공급' },
        { id: 'comp', label: '경쟁사', group: 'competitor', sub: '경쟁' },
        { id: 'prod', label: '핵심 제품', group: 'product', sub: '제품' },
        { id: 'fx', label: '원/달러', group: 'macro', sub: '거시' },
      ],
      edges: [
        { from: symbol, to: 'cust', weight: 0.24, note: '주요 고객 매출 의존도 추정 24%', emphasized: true },
        { from: symbol, to: 'sup', weight: 0.15, note: '공급망 조달 의존 15%' },
        { from: symbol, to: 'comp', weight: 0.18, note: '점유율 경쟁 강도 18%' },
        { from: symbol, to: 'prod', weight: 0.3, note: '핵심 제품 매출 비중 30%' },
        { from: symbol, to: 'fx', weight: 0.2, note: '환율 민감도 추정 20%' },
      ],
    },
  };
}

export function companyDataFor(symbol: string): CompanyData {
  return companyData[symbol] ?? derivedCompanyData(symbol);
}
