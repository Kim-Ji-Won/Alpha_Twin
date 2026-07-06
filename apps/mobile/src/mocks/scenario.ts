import { Scenario, ScenarioResult } from '../types';
export const mockScenario: Scenario = {
  id: 'sc-1',
  rawQuery: '원/달러 환율이 10% 하락하면 SK하이닉스는 어떻게 될까?',
  parsed: { variable: 'USD/KRW', from: '1,420', to: '1,280', horizon: '3개월' },
};
export const scenarioTemplates = [
  '미 기준금리 +1%p', '유가 $100 돌파', 'AI 데이터센터 투자 -20%', '경쟁사 가격 15% 인하', '중국 매출 급감', '반도체 회복 6개월 지연',
];
export const mockScenarioResult: ScenarioResult = {
  scenarioId: 'sc-1', symbol: '000660',
  conclusion: '환율 10% 하락은 수출 매출 환산 감소로 단기 영업이익에 부정적이며, 기업 상태 점수가 74에서 63으로 낮아질 가능성이 있습니다. 다만 외화부채 상환 부담 완화가 일부를 상쇄합니다.',
  transmissionPath: [
    { step: '환율 하락', effect: '달러 매출 원화 환산 감소', direction: 'negative' },
    { step: '매출 환산 감소', effect: '영업이익률 압박', direction: 'negative' },
    { step: '외화부채', effect: '상환 부담 완화', direction: 'positive' },
    { step: '외국인 수급', effect: '환차익 기대 유입 vs 실적 우려', direction: 'mixed' },
  ],
  deltas: [
    { label: '기업 상태', before: 74, after: 63, direction: 'negative' },
    { label: '시장 초과수익 확률', before: '61%', after: '49%', direction: 'negative' },
    { label: '위험도', before: '보통', after: '높음', direction: 'negative' },
    { label: '논제 건강도', before: 78, after: 65, direction: 'negative' },
  ],
  affectedCompanies: [
    { symbol: '005380', name: '현대차', impact: '수출 채산성 악화', direction: 'negative' },
    { symbol: '010120', name: 'LS일렉트릭', impact: '북미 수주 환산 감소', direction: 'negative' },
  ],
  confidence: { level: 'medium', score: 0.71 },
  asOf: '2026-07-06T09:00:00+09:00',
};
