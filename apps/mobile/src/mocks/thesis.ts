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
