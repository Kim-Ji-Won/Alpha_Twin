import { Scenario, ScenarioResult, ScenarioTemplate } from '../types';

// ── 빠른 시나리오 템플릿 6종 (디자인 프레임 03 tkgrid와 1:1) ─────────────
// 선택 시 rawQuery(입력창)와 parsed(구조화 미리보기)가 함께 바뀐다.
export const scenarioTemplates: ScenarioTemplate[] = [
  {
    id: 'fx-down',
    label: '환율', valueLabel: '−10%',
    rawQuery: '원/달러 환율이 10% 하락하면 어떻게 될까?',
    parsed: { variable: 'USD/KRW 환율', from: '1,420', to: '1,280 (−9.9%)', horizon: '3개월 점진적', impactItems: '수출매출 · 외화부채' },
    title: '환율 −10%', badge: 'USD/KRW 1,280',
  },
  {
    id: 'rate-up',
    label: '미 기준금리', valueLabel: '+1%p',
    rawQuery: '미국 기준금리가 1%p 인상되면 어떻게 될까?',
    parsed: { variable: '미 연방기금금리', from: '4.50%', to: '5.50% (+1%p)', horizon: '6개월 단계적', impactItems: '할인율 · 외국인 수급' },
    title: '미 기준금리 +1%p', badge: 'FFR 5.50%',
  },
  {
    id: 'oil-100',
    label: '유가', valueLabel: '$100',
    rawQuery: '국제유가가 배럴당 100달러를 돌파하면 어떻게 될까?',
    parsed: { variable: 'WTI 유가', from: '$78', to: '$100 (+28%)', horizon: '3개월 급등', impactItems: '원가율 · 물류비' },
    title: '유가 $100', badge: 'WTI $100',
  },
  {
    id: 'capex-down',
    label: 'AI capex', valueLabel: '−20%',
    rawQuery: 'AI 데이터센터 설비투자가 20% 감소하면 어떻게 될까?',
    parsed: { variable: '빅테크 AI capex', from: '전망치 100%', to: '80% (−20%)', horizon: '12개월 누적', impactItems: 'HBM 수요 · 수주 잔고' },
    title: 'AI capex −20%', badge: 'CAPEX −20%',
  },
  {
    id: 'china-down',
    label: '중국 매출', valueLabel: '↓',
    rawQuery: '중국 매출이 급감하면 어떻게 될까?',
    parsed: { variable: '중국 지역 매출', from: '비중 24%', to: '비중 15% (−9%p)', horizon: '2개 분기', impactItems: '지역 매출 · 가동률' },
    title: '중국 매출 급감', badge: 'CN −9%p',
  },
  {
    id: 'price-cut',
    label: '경쟁사 가격', valueLabel: '−15%',
    rawQuery: '경쟁사가 가격을 15% 인하하면 어떻게 될까?',
    parsed: { variable: '경쟁사 판매가격', from: '기준 100', to: '85 (−15%)', horizon: '1개 분기', impactItems: 'ASP · 점유율' },
    title: '경쟁사 가격 −15%', badge: 'PRICE −15%',
  },
];

export const mockScenario: Scenario = {
  id: 'sc-1',
  rawQuery: '원/달러 환율이 10% 하락하면 SK하이닉스는 어떻게 될까?',
  parsed: scenarioTemplates[0].parsed,
  templateId: 'fx-down',
  title: '환율 −10%',
  badge: 'USD/KRW 1,280',
  parseConfidence: 0.92,
};

// ── 결과: fx-down은 디자인 프레임 04와 1:1, 나머지는 템플릿별 변형 ────────
export const mockScenarioResult: ScenarioResult = {
  scenarioId: 'sc-1', symbol: '000660',
  conclusion:
    '환율 10% 하락은 수출 매출 환산 감소로 단기 영업이익에 부정적이며, 기업 상태 점수가 74에서 63으로 낮아질 가능성이 있습니다. 다만 외화부채 상환 부담 완화가 일부를 상쇄합니다.',
  transmissionPath: [
    { step: '환율 ↓', effect: '달러 매출 원화 환산 감소', direction: 'negative' },
    { step: '수출단가 환산↓', effect: '영업이익률 압박', direction: 'negative' },
    { step: '영업이익↓', effect: '이익 추정 하향', direction: 'negative' },
    { step: '상태점수↓', effect: '기업 상태 74 → 63', direction: 'negative' },
  ],
  transmissionNote: '해외 매출 비중이 높아 단기 영업이익에 부정적. 다만 달러 외화부채 상환 부담은 완화됩니다.',
  deltas: [
    { label: '기업 상태 점수', before: 74, after: 63, direction: 'negative' },
    { label: '시장 초과수익 확률', before: '61%', after: '49%', direction: 'negative' },
    { label: '위험도', before: '보통', after: '높음', direction: 'negative' },
    { label: '투자 논제 건강도', before: 78, after: 65, direction: 'negative' },
  ],
  impacts: [
    { label: '영업이익', pct: 0.64, valueText: '−8.4%', direction: 'negative' },
    { label: '수출매출', pct: 0.52, valueText: '−6.1%', direction: 'negative' },
    { label: '외화부채', pct: 0.34, valueText: '+4.2%', direction: 'positive' },
    { label: '외국인 수급', pct: 0.22, valueText: '혼합', direction: 'mixed' },
  ],
  affectedCompanies: [
    { symbol: '005930', name: '삼성전자', impact: '수출 매출 환산 감소', direction: 'negative' },
    { symbol: '005380', name: '현대차', impact: '수출 채산성 악화', direction: 'negative' },
    { symbol: '010120', name: 'LS일렉트릭', impact: '북미 수주 환산 감소', direction: 'negative' },
  ],
  portfolioImpact: {
    summary: '보유 포트폴리오 예상 가치 −3.8%. 환율 민감도가 41%로 집중되어 있어 단일 변수에 취약합니다.',
    exposureLabel: '환율 노출',
    exposurePct: 0.41,
  },
  confidence: { level: 'medium', score: 0.71 },
  asOf: '2026-07-06T09:00:00+09:00',
};

// 템플릿별 결과 변형 — 실서비스에서는 ML/LLM 결과로 교체 (시그니처 유지)
export function scenarioResultFor(templateId: string | undefined, symbol: string): ScenarioResult {
  const base: ScenarioResult = { ...mockScenarioResult, symbol };
  switch (templateId) {
    case 'rate-up':
      return {
        ...base,
        conclusion:
          '기준금리 1%p 인상은 할인율 상승과 외국인 수급 이탈로 밸류에이션에 부담이며, 기업 상태 점수가 74에서 67로 낮아질 가능성이 있습니다.',
        transmissionPath: [
          { step: '금리 ↑', effect: '할인율 상승', direction: 'negative' },
          { step: '밸류에이션 부담', effect: '멀티플 압축', direction: 'negative' },
          { step: '외국인 수급', effect: '위험자산 회피', direction: 'negative' },
          { step: '상태점수↓', effect: '기업 상태 74 → 67', direction: 'negative' },
        ],
        transmissionNote: '성장주 밸류에이션 부담이 커지지만 실적 자체의 직접 훼손은 제한적입니다.',
        deltas: [
          { label: '기업 상태 점수', before: 74, after: 67, direction: 'negative' },
          { label: '시장 초과수익 확률', before: '61%', after: '54%', direction: 'negative' },
          { label: '위험도', before: '보통', after: '높음', direction: 'negative' },
          { label: '투자 논제 건강도', before: 78, after: 72, direction: 'negative' },
        ],
        impacts: [
          { label: '할인율', pct: 0.58, valueText: '+1%p', direction: 'negative' },
          { label: '외국인 수급', pct: 0.44, valueText: '유출', direction: 'negative' },
          { label: '이자비용', pct: 0.21, valueText: '+2.3%', direction: 'negative' },
          { label: '이자수익', pct: 0.15, valueText: '+1.1%', direction: 'positive' },
        ],
      };
    case 'oil-100':
      return {
        ...base,
        conclusion:
          '유가 $100 돌파는 원가율과 물류비 상승으로 이익률에 부정적이나, 에너지 비중이 낮은 사업 구조라 영향은 제한적입니다.',
        transmissionPath: [
          { step: '유가 ↑', effect: '에너지·물류비 상승', direction: 'negative' },
          { step: '원가율 ↑', effect: '이익률 압박', direction: 'negative' },
          { step: '상태점수↓', effect: '기업 상태 74 → 70', direction: 'negative' },
        ],
        transmissionNote: '전력 단가 상승분의 판가 전가 여부가 관건입니다.',
        deltas: [
          { label: '기업 상태 점수', before: 74, after: 70, direction: 'negative' },
          { label: '시장 초과수익 확률', before: '61%', after: '57%', direction: 'negative' },
          { label: '위험도', before: '보통', after: '보통', direction: 'neutral' },
          { label: '투자 논제 건강도', before: 78, after: 75, direction: 'negative' },
        ],
        impacts: [
          { label: '원가율', pct: 0.4, valueText: '+1.8%p', direction: 'negative' },
          { label: '물류비', pct: 0.3, valueText: '+4.6%', direction: 'negative' },
          { label: '영업이익', pct: 0.24, valueText: '−2.1%', direction: 'negative' },
          { label: '판가 전가', pct: 0.18, valueText: '부분', direction: 'mixed' },
        ],
      };
    case 'capex-down':
      return {
        ...base,
        conclusion:
          'AI 설비투자 20% 감소는 HBM 수요 전망을 직접 훼손해 기업 상태 점수가 74에서 58로 크게 낮아질 수 있는 고위험 시나리오입니다.',
        transmissionPath: [
          { step: 'AI capex ↓', effect: '데이터센터 투자 축소', direction: 'negative' },
          { step: 'HBM 수요 ↓', effect: '수주 잔고 감소', direction: 'negative' },
          { step: '가동률 ↓', effect: '고정비 부담 확대', direction: 'negative' },
          { step: '상태점수↓', effect: '기업 상태 74 → 58', direction: 'negative' },
        ],
        transmissionNote: '핵심 성장 동력인 HBM 수요가 직접 영향권입니다. 논제 실패 조건에 근접합니다.',
        deltas: [
          { label: '기업 상태 점수', before: 74, after: 58, direction: 'negative' },
          { label: '시장 초과수익 확률', before: '61%', after: '41%', direction: 'negative' },
          { label: '위험도', before: '보통', after: '높음', direction: 'negative' },
          { label: '투자 논제 건강도', before: 78, after: 55, direction: 'negative' },
        ],
        impacts: [
          { label: 'HBM 수요', pct: 0.7, valueText: '−20%', direction: 'negative' },
          { label: '매출 전망', pct: 0.55, valueText: '−11.2%', direction: 'negative' },
          { label: '영업이익', pct: 0.62, valueText: '−15.8%', direction: 'negative' },
          { label: '재고자산', pct: 0.35, valueText: '+9.4%', direction: 'negative' },
        ],
      };
    case 'china-down':
      return {
        ...base,
        conclusion:
          '중국 매출 급감은 지역 매출 공백과 가동률 하락으로 이어지나, 미주·유럽 수요가 일부를 상쇄해 상태 점수는 74에서 66으로 완만히 낮아질 전망입니다.',
        transmissionPath: [
          { step: '중국 매출 ↓', effect: '지역 매출 −9%p', direction: 'negative' },
          { step: '가동률 ↓', effect: '고정비 부담', direction: 'negative' },
          { step: '타 지역 수요', effect: '부분 상쇄', direction: 'positive' },
          { step: '상태점수↓', effect: '기업 상태 74 → 66', direction: 'negative' },
        ],
        transmissionNote: '지역 포트폴리오 다변화 수준이 완충 역할을 합니다.',
        deltas: [
          { label: '기업 상태 점수', before: 74, after: 66, direction: 'negative' },
          { label: '시장 초과수익 확률', before: '61%', after: '52%', direction: 'negative' },
          { label: '위험도', before: '보통', after: '높음', direction: 'negative' },
          { label: '투자 논제 건강도', before: 78, after: 70, direction: 'negative' },
        ],
        impacts: [
          { label: '중국 매출', pct: 0.52, valueText: '−9%p', direction: 'negative' },
          { label: '가동률', pct: 0.34, valueText: '−4.1%p', direction: 'negative' },
          { label: '영업이익', pct: 0.4, valueText: '−6.6%', direction: 'negative' },
          { label: '미주 매출', pct: 0.2, valueText: '+2.8%', direction: 'positive' },
        ],
      };
    case 'price-cut':
      return {
        ...base,
        conclusion:
          '경쟁사 15% 가격 인하는 ASP 하락 압력과 점유율 경쟁 심화로 이어져 기업 상태 점수가 74에서 64로 낮아질 가능성이 있습니다.',
        transmissionPath: [
          { step: '경쟁사 가격 ↓', effect: 'ASP 인하 압력', direction: 'negative' },
          { step: 'ASP ↓', effect: '마진 축소', direction: 'negative' },
          { step: '점유율 방어', effect: '물량 유지 vs 마진 훼손', direction: 'mixed' },
          { step: '상태점수↓', effect: '기업 상태 74 → 64', direction: 'negative' },
        ],
        transmissionNote: '프리미엄 제품 비중이 높을수록 가격 경쟁 영향은 완화됩니다.',
        deltas: [
          { label: '기업 상태 점수', before: 74, after: 64, direction: 'negative' },
          { label: '시장 초과수익 확률', before: '61%', after: '50%', direction: 'negative' },
          { label: '위험도', before: '보통', after: '높음', direction: 'negative' },
          { label: '투자 논제 건강도', before: 78, after: 68, direction: 'negative' },
        ],
        impacts: [
          { label: 'ASP', pct: 0.48, valueText: '−5.2%', direction: 'negative' },
          { label: '영업이익', pct: 0.44, valueText: '−7.3%', direction: 'negative' },
          { label: '점유율', pct: 0.25, valueText: '방어', direction: 'mixed' },
          { label: '출하량', pct: 0.18, valueText: '+1.9%', direction: 'positive' },
        ],
      };
    default:
      return base; // fx-down 및 자유 입력 → 디자인 프레임 04 기준 결과
  }
}
