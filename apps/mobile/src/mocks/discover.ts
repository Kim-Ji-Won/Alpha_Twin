// 프레임 08 — Discover: 이상 신호 · 산업 트윈 · Narrative Gap · 자연어 탐색.
import { DiscoverSignal, IndustryTwin, NarrativeGapItem } from '../types';

export const discoverNaturalQueries = [
  'HBM 공급망에서 저평가된 기업',
  '금리 인하 수혜 + 부채 적은 기업',
  '최근 이상 수급 감지 종목',
];

// AI 이상 신호 — symbol은 mockStocks에 실존하는 종목만 사용 (정합성 규칙)
export const mockDiscoverSignals: DiscoverSignal[] = [
  {
    id: 'ds-1',
    symbol: '010120',
    name: 'LS일렉트릭',
    sector: '전력기기',
    badge: '수급 이상 · 3.2σ',
    tone: 'accent',
    title: 'LS일렉트릭 — 뉴스 없는 대량 매집',
    detail: '기관 순매수 5일 연속, 관련 공시 없음. 수급 선행 패턴.',
    recommendReason: '추천 이유 · 보유 중인 LS일렉트릭 — 수급 변화가 직접 영향',
    recommendReasonHighlights: [{ text: '보유 중인 LS일렉트릭', tone: 'strong' }],
  },
  {
    id: 'ds-2',
    symbol: '042700',
    name: '한미반도체',
    sector: '반도체',
    badge: '괴리 확대',
    tone: 'warn',
    title: '한미반도체 — 주가·펀더멘털 괴리 상위 5%',
    detail: '주가 +34% 대비 실적 전망 변화 없음. Narrative Gap 높음.',
    recommendReason: "추천 이유 · 내 논제 'HBM 경쟁력'과 같은 공급망 — 간접 노출",
    recommendReasonHighlights: [{ text: "내 논제 'HBM 경쟁력'", tone: 'warning' }],
  },
];

export const mockIndustryTwins: IndustryTwin[] = [
  { name: '반도체 · 업황 회복 중반', score: 76, direction: 'positive' },
  { name: '전력 인프라 · 수요 초과', score: 81, direction: 'positive' },
  { name: '2차전지 · 재고 조정', score: 52, direction: 'mixed' },
  { name: '바이오 · 자금 위축', score: 41, direction: 'negative' },
];

// Narrative Gap 상위 — A사/B사는 디자인 원본의 익명 표기 유지 (표시 전용, 이동 불가)
export const mockNarrativeGaps: NarrativeGapItem[] = [
  { label: 'A사 (AI 테마)', narrativeScore: 91, revenueEvidence: 34 },
  { label: 'B사 (로봇)', narrativeScore: 78, revenueEvidence: 41 },
  { label: 'SK하이닉스', symbol: '000660', narrativeScore: 62, revenueEvidence: 58 },
];
