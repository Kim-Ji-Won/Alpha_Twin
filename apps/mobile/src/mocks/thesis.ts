import { InvestmentThesis } from '../types';
export const mockThesis: InvestmentThesis = {
  id: 'th-1', symbol: '000660', version: 3,
  rawText: '이 기업은 AI 반도체 수요 증가와 HBM 경쟁력 회복으로 향후 실적이 개선될 것이라고 생각한다.',
  createdAt: '2026-03-14',
  healthScore: 78, healthTrend: { delta: -6, period: '1D' },
  healthHistory: [
    { date: '2026-03-14', score: 81 }, { date: '2026-04-02', score: 79 },
    { date: '2026-05-17', score: 79 }, { date: '2026-06-28', score: 84 },
    { date: '2026-07-06', score: 78 },
  ],
  hypotheses: [
    { id: 'h1', text: 'AI 반도체 수요가 지속적으로 증가한다', status: 'confirmed', evidenceNote: '데이터센터 capex 전망 +32% 상향 · 근거 확인됨' },
    { id: 'h2', text: 'HBM 고객사 인증이 완료된다', status: 'watch', evidenceNote: '12단 인증 일정 4주 지연 보도 · 주시 필요' },
    { id: 'h3', text: 'HBM 매출 비중이 증가한다', status: 'confirmed', evidenceNote: '1Q 기준 31% → 38% · 확인됨' },
    { id: 'h4', text: '반도체 부문 영업이익률이 개선된다', status: 'unverified', evidenceNote: '다음 실적 발표(7/24) 전까지 미확인' },
  ],
  signals: [
    { label: 'HBM 출하량 (QoQ)', value: '+24%', direction: 'positive' },
    { label: '메모리 평균판매가격', value: '+11%', direction: 'positive' },
    { label: '고객사 인증 일정', value: '지연', direction: 'mixed' },
    { label: '경쟁사 점유율 격차', value: '-3%p', direction: 'negative' },
  ],
  killCriteria: [
    { text: '인증 일정 추가 지연', status: 'approaching' },
    { text: '점유율 격차 확대', status: 'safe' },
    { text: 'AI 인프라 투자 둔화', status: 'safe' },
    { text: '예상보다 낮은 수율 지속', status: 'safe' },
  ],
  evidence: { positive: 8, negative: 5, unverified: 3 },
  changes: [
    { date: '2026-07-06', kind: 'auto', scoreBefore: 84, scoreAfter: 78, reason: '경쟁사 HBM 양산 일정 단축 발표 — 가설 2의 경쟁 환경 악화. 부정 근거 +1.' },
    { date: '2026-06-28', kind: 'auto', scoreBefore: 79, scoreAfter: 84, reason: 'HBM 출하량 QoQ +24% 확인 — 가설 3 근거 확보. 긍정 근거 +2.' },
    { date: '2026-05-17', kind: 'user_edit', reason: '"경쟁력 회복" → "12단 인증 기반 점유율 방어"로 가설 구체화. 추적 지표에 경쟁사 점유율 추가.' },
    { date: '2026-04-02', kind: 'auto', scoreBefore: 81, scoreAfter: 79, reason: '메모리 ASP 상승세 둔화 — 가설 4 확인 지연.' },
    { date: '2026-03-14', kind: 'created', reason: '최초 작성 · 가설 4 · 지표 6 · 실패 조건 4로 구조화. 감시 시작.' },
  ],
};

// ── 종목별 논제 (P1 감사 #2: id/종목 무시 수정 — 키 구조) ─────────────────
// 관심 목록 프레임 24 기준: LS일렉트릭 논제 88 ▲2 (th-2) · 현대차 72 ▲1 (th-3)
const mockThesisLs: InvestmentThesis = {
  id: 'th-2', symbol: '010120', version: 1,
  rawText: '북미 전력 인프라 투자 확대로 배전기기 수주가 구조적으로 늘어날 것이라고 생각한다.',
  createdAt: '2026-04-21',
  healthScore: 88, healthTrend: { delta: 2, period: '1D' },
  healthHistory: [
    { date: '2026-04-21', score: 80 }, { date: '2026-05-20', score: 83 },
    { date: '2026-06-15', score: 86 }, { date: '2026-07-06', score: 88 },
  ],
  hypotheses: [
    { id: 'h1', text: '북미 전력망 투자가 지속 확대된다', status: 'confirmed', evidenceNote: '북미 신규 수주 공시 확인 · 근거 확보' },
    { id: 'h2', text: '배전기기 수주잔고가 증가한다', status: 'confirmed', evidenceNote: '수주잔고 YoY +41% · 확인됨' },
    { id: 'h3', text: '수익성 높은 초고압 비중이 늘어난다', status: 'unverified', evidenceNote: '다음 실적 발표 전까지 미확인' },
  ],
  signals: [
    { label: '북미 수주잔고 (YoY)', value: '+41%', direction: 'positive' },
    { label: '초고압 매출 비중', value: '28%', direction: 'positive' },
    { label: '구리 가격', value: '+6%', direction: 'mixed' },
  ],
  killCriteria: [
    { text: '북미 전력 투자 예산 축소', status: 'safe' },
    { text: '수주잔고 2개 분기 연속 감소', status: 'safe' },
  ],
  evidence: { positive: 6, negative: 1, unverified: 2 },
  changes: [
    { date: '2026-07-06', kind: 'auto', scoreBefore: 86, scoreAfter: 88, reason: '북미 신규 수주 공시 — 가설 1 근거 강화. 긍정 근거 +1.' },
    { date: '2026-04-21', kind: 'created', reason: '최초 작성 · 가설 3 · 지표 3 · 실패 조건 2로 구조화. 감시 시작.' },
  ],
};

const mockThesisHyundai: InvestmentThesis = {
  id: 'th-3', symbol: '005380', version: 2,
  rawText: '하이브리드 판매 비중 확대와 미국 현지 생산으로 관세 리스크를 상쇄하며 이익이 유지될 것이라고 생각한다.',
  createdAt: '2026-02-09',
  healthScore: 72, healthTrend: { delta: 1, period: '1D' },
  healthHistory: [
    { date: '2026-02-09', score: 75 }, { date: '2026-03-30', score: 70 },
    { date: '2026-05-11', score: 69 }, { date: '2026-07-06', score: 72 },
  ],
  hypotheses: [
    { id: 'h1', text: '하이브리드 판매 비중이 계속 늘어난다', status: 'confirmed', evidenceNote: '2Q 하이브리드 비중 19% → 23% · 확인됨' },
    { id: 'h2', text: '미국 현지 생산이 관세 영향을 상쇄한다', status: 'watch', evidenceNote: '관세 협상 경과에 따라 변동 · 주시 필요' },
    { id: 'h3', text: '환율이 수출 채산성을 지지한다', status: 'watch', evidenceNote: '환율 하락 시 채산성 악화 위험 · 주시 필요' },
  ],
  signals: [
    { label: '하이브리드 판매 비중', value: '23%', direction: 'positive' },
    { label: '미국 판매량 (YoY)', value: '+8%', direction: 'positive' },
    { label: '원/달러 환율', value: '−1.2%', direction: 'negative' },
  ],
  killCriteria: [
    { text: '미국 관세율 인상 확정', status: 'safe' },
    { text: '환율 1,300 하회 지속', status: 'approaching' },
  ],
  evidence: { positive: 5, negative: 3, unverified: 2 },
  changes: [
    { date: '2026-07-06', kind: 'auto', scoreBefore: 69, scoreAfter: 72, reason: '미국 판매량 YoY +8% — 가설 1·2 근거 강화.' },
    { date: '2026-03-30', kind: 'user_edit', reason: '가설에 "환율 채산성" 추가 · v2로 수정. 추적 지표에 원/달러 환율 추가.' },
    { date: '2026-02-09', kind: 'created', reason: '최초 작성 · 가설 3 · 지표 3 · 실패 조건 2로 구조화. 감시 시작.' },
  ],
};

export const mockTheses: InvestmentThesis[] = [mockThesis, mockThesisLs, mockThesisHyundai];

