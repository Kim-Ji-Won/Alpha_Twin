import { AIAnalysis } from '../types';
export const mockAnalysis: AIAnalysis = {
  id: 'ans-1',
  question: 'SK하이닉스 최근 주가 상승은 실적 개선 때문이야, 기대감 때문이야?',
  symbol: '000660',
  conclusion: '둘 다 작용했지만, 약 60%는 실적, 40%는 기대감으로 추정됩니다.',
  conclusionHighlights: [
    { text: '약 60%는 실적', tone: 'positive' },
    { text: '40%는 기대감', tone: 'warning' },
  ],
  keyReasons: '최근 3개월 상승분 중 컨센서스 영업이익 상향(+18%)이 설명하는 부분이 가장 큽니다. 나머지는 HBM4 기대를 반영한 멀티플 확장(P/B 1.6→2.1)입니다.',
  counterCase: '기대 선반영 구간에서는 실적이 컨센서스를 충족해도 주가가 하락한 사례가 과거 4회 중 3회 있었습니다.',
  dataPoints: [
    { label: '컨센서스 변화', value: '+18% (3M)', direction: 'positive' },
    { label: 'P/B 멀티플', value: '2.1x · 상단', direction: 'mixed' },
    { label: '외국인 순매수', value: '+1.2조원', direction: 'positive' },
  ],
  evidence: {
    asOf: '2026-06-29T18:00:00+09:00',
    confidence: { level: 'high', score: 0.86 },
    unverifiedAreas: ['2Q 확정 실적 (7/24 공개)'],
    modelAttribution: [
      { label: '재무 데이터 (ML)', weight: 0.52 },
      { label: '이벤트 분석 (DL)', weight: 0.31 },
      { label: '시장 심리', weight: 0.17 },
    ],
    sources: [
      { id: 'src-1', kind: 'filing', title: 'DART · 1Q26 분기보고서', date: '2026-04-29',
        excerpt: '재고자산은 전분기 대비 34.2% 증가한 12.8조원… 주요 원인은 HBM 생산 확대에 따른 원재료 선매입' },
      { id: 'src-2', kind: 'transcript', title: '컨퍼런스콜 녹취 · 1Q26', date: '2026-04-29',
        excerpt: '고객 수요는 여전히 견조하며, 하반기 공급 계약은 대부분 확정된 상태입니다 — CFO' },
      { id: 'src-3', kind: 'consensus', title: 'Bloomberg 컨센서스', date: '2026-06-27',
        excerpt: '2Q 영업이익 추정치 3개월간 +18% 상향 · 애널리스트 28명', caveat: '확정 실적 아님' },
    ],
  },
  followUps: ['내 논제에 반대되는 근거는?', '경쟁사 대비 약점은?', '현재 위험 구간은?', '실적과 기대감 비중은?'],
};

// 후속 질문별 Mock 응답 — 실서비스에서는 LLM이 ML/DL 결과를 설명 (수치 생성 금지)
const variant = (partial: Partial<AIAnalysis> & { id: string; question: string }): AIAnalysis => ({
  ...mockAnalysis,
  followUps: mockAnalysis.followUps,
  ...partial,
});

export const mockAnalysisVariants: AIAnalysis[] = [
  variant({
    id: 'ans-counter',
    question: '내 논제에 반대되는 근거는?',
    conclusion: "논제 'HBM 경쟁력 회복'에 반대되는 근거는 현재 2건이며, 가장 강한 것은 경쟁사 양산 일정 단축입니다.",
    keyReasons: '경쟁사 HBM 양산 일정 6개월 단축 발표로 점유율 방어 가설(가설 2)의 경쟁 환경이 악화됐습니다. 재고자산 +34% 증가도 수요 견조 발언과 상충합니다.',
    counterCase: '반대로, 12단 인증이 예정대로 완료되면 두 근거 모두 영향이 제한적일 수 있습니다. 인증 일정이 핵심 변수입니다.',
    dataPoints: [
      { label: '경쟁사 양산 일정', value: '6개월 단축', direction: 'negative' },
      { label: '재고자산 (QoQ)', value: '+34%', direction: 'negative' },
      { label: '12단 인증', value: '4주 지연', direction: 'mixed' },
    ],
  }),
  variant({
    id: 'ans-weakness',
    question: '경쟁사 대비 약점은?',
    conclusion: '수율 안정성과 고객 다변화에서 경쟁사 대비 열위이며, 가격 협상력은 HBM 인증 결과에 달려 있습니다.',
    keyReasons: '경쟁사는 이미 복수 고객 인증을 마쳐 공급처가 분산돼 있습니다. 반면 현재 매출의 28%가 단일 고객(추정)에 집중되어 있어 협상력이 상대적으로 약합니다.',
    counterCase: '단일 고객 집중은 해당 고객의 투자가 유지되는 동안에는 오히려 물량 안정성으로 작용합니다.',
    dataPoints: [
      { label: '단일 고객 의존(추정)', value: '28%', direction: 'mixed' },
      { label: '경쟁사 고객 인증', value: '복수 완료', direction: 'negative' },
      { label: '수율 격차(추정)', value: '−5%p', direction: 'negative' },
    ],
  }),
  variant({
    id: 'ans-risk',
    question: '현재 위험 구간은?',
    conclusion: '밸류에이션이 부담 구간(P/B 2.1x 밴드 상단)이라, 실적이 컨센서스에 부합해도 조정 위험이 있는 구간입니다.',
    keyReasons: '기대 선반영 구간에서는 "컨센서스 충족 = 주가 유지"가 성립하지 않은 사례가 과거 4회 중 3회였습니다. 20일 변동성도 저점 대비 상승 중입니다.',
    counterCase: '다만 외국인 순매수가 이어지는 동안에는 수급이 밸류에이션 부담을 상쇄해 왔습니다.',
    dataPoints: [
      { label: 'P/B 멀티플', value: '2.1x · 상단', direction: 'negative' },
      { label: '95% 예상 낙폭', value: '−14%', direction: 'negative' },
      { label: '외국인 순매수', value: '+1.2조원', direction: 'positive' },
    ],
  }),
  variant({
    id: 'ans-split',
    question: '실적과 기대감 비중은?',
    conclusion: '최근 3개월 상승분 기준 실적 요인 약 60%, 기대감(멀티플 확장) 약 40%로 추정됩니다.',
    keyReasons: '컨센서스 영업이익 상향(+18%)이 설명하는 상승분이 가장 크고, 나머지는 HBM4 기대를 반영한 P/B 1.6→2.1 확장입니다.',
    counterCase: '기대감 비중 40%는 뉴스 플로우에 민감합니다. 인증 지연 뉴스 한 건으로도 단기 되돌림이 가능합니다.',
  }),
];

export function analysisForQuestion(question: string): AIAnalysis {
  const q = question.trim();
  return mockAnalysisVariants.find(v => v.question === q) ?? { ...mockAnalysis, question: q };
}
