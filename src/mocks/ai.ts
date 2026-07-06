import { AIAnalysis } from '../types';
export const mockAnalysis: AIAnalysis = {
  id: 'ans-1',
  question: 'SK하이닉스 최근 주가 상승은 실적 개선 때문이야, 기대감 때문이야?',
  conclusion: '둘 다 작용했지만, 약 60%는 실적, 40%는 기대감으로 추정됩니다.',
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
  followUps: ['내 논제에 반대되는 근거는?', '경쟁사 대비 약점은?', '과거 유사 구간은?'],
};
