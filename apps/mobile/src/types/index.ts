// ALPHA TWIN — domain types. Every screen renders exactly these shapes.
export type Direction = 'positive' | 'negative' | 'mixed' | 'neutral';

export * from './ai';

// P3-A — 문장 내 키워드 강조 스팬 (실서비스: LLM이 스팬을 함께 반환)
export type HighlightTone = 'strong' | 'accent' | 'positive' | 'negative' | 'warning';
export interface Highlight { text: string; tone: HighlightTone; }
export type Severity = 'high' | 'medium' | 'low';
export type Confidence = { level: 'high' | 'medium' | 'low'; score: number }; // 0..1
export type Trend = { delta: number; period: string }; // e.g. {delta:-6, period:'1D'}

export interface Stock {
  symbol: string;            // '000660'
  name: string;              // 'SK하이닉스'
  sector: string;
  price: number;
  changePct: number;
  healthScore: number;       // 0..100 기업 상태 점수
  thesisId?: string;
  flags?: Array<'narrative_gap' | 'anomaly' | 'stale_data'>;
  market?: string;
  currency?: string;
  change?: number;
  volume?: number;
  tradingValue?: number;
  asOf?: string;
  source?: string;
  stale?: boolean;
  fallback?: boolean;
  dataMode?: 'eod' | 'realtime' | 'mock';
  priceAdjustment?: 'raw' | 'adjusted' | 'unknown';
}

export interface StockCandle {
  symbol: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
}

export interface MarketDataMetadata {
  asOf: string;
  source: string;
  stale: boolean;
  fallback: boolean;
  dataMode?: 'eod' | 'realtime' | 'mock';
  priceAdjustment?: 'raw' | 'adjusted' | 'unknown';
  partial: boolean;
  mode: 'live' | 'confirmed' | 'stale' | 'partial' | 'fallback';
}

export interface CompanyMarketData {
  quote: Stock | null;
  candles: StockCandle[];
  metadata: MarketDataMetadata;
}

export interface MarketRegime {
  label: string;             // '저변동성 상승 국면'
  probability: number;       // 유지 확률 0..1
  probabilityTrend: Trend;
  riskLevel: Severity;
  sentiment: string;
  volatility: string;
  asOf: string;              // ISO datetime — ALWAYS displayed
  // P1 표시 필드 (디자인 프레임 01 히어로)
  en?: string;               // 'Low-Volatility Uptrend · 신뢰도 안정'
  summary?: string;          // AI 시장 요약 문단
  confidence?: number;       // 국면 신뢰도 0..1
  riskNote?: string;         // 'VIX 14.2 ▼'
  sentimentTrend?: string;   // '▲ 전일 +4'
  volatilityNote?: string;   // '20D 11.3%'
  indexLabel?: string;       // 'KOSPI 2,894'
}

// 프레임 01 — 내 포트폴리오 영향 알림 (Market Brain)
export interface PortfolioImpactNotice {
  headline: string;
  headlineHighlights?: Highlight[];          // '보유 종목 중 3개가 오늘 원/달러 환율 하락(−1.2%)에 노출...'
  symbols: { symbol: string; name: string }[];
}

// 프레임 01 — AI 이상 신호
export interface AnomalySignal {
  id: string;
  symbol?: string;
  name: string;
  sigma: number;             // 3.2
  note: string;
}

export interface HealthArea {
  key: 'growth'|'profitability'|'stability'|'cashflow'|'valuation'|'flow'|'momentum'|'expectation'|'risk';
  label: string;
  score: number;             // 0..100
  trend: Trend;
  reason: string;            // 점수가 변한 이유 — 필수
}
export interface CompanyHealth {
  symbol: string;
  total: number;
  confidence: Confidence;
  areas: HealthArea[];
  upsideDrivers: string[];
  downsideRisks: string[];
  asOf: string;
  // P1 표시 필드 (디자인 프레임 02)
  totalTrend?: Trend;        // 기업 상태 ▲ +3 (7D)
  riskLevel?: Severity;      // 위험 수준 셀
  riskNote?: string;         // '변동성 ↑'
  summary?: string;          // AI 기업 요약 문장
  summaryHighlights?: Highlight[];
  changeNote?: string;       // '변화 원인 · 모멘텀 점수가 ... +9 상승'
}

// 프레임 02 — 기업 관계 네트워크 (P1: 고정 좌표 기반)
export interface NetworkNode {
  id: string;
  label: string;
  group: 'customer' | 'supplier' | 'competitor' | 'product' | 'macro' | 'market';
  sub?: string;              // '핵심 고객' 등 보조 라벨
}
export interface NetworkEdge {
  from: string;
  to: string;
  weight: number;            // 의존도 0..1 — 엣지 굵기
  note?: string;             // '매출 의존도 추정 28% · 경로: ...'
  emphasized?: boolean;
}
export interface CompanyNetwork {
  center: { id: string; label: string };
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}

export interface CompanyEvent {
  id: string;
  symbol: string;
  /** 해외/거시 이벤트가 파급되는 국내 종목 — 탭 시 해당 Company Twin으로 이동 */
  relatedSymbol?: string;
  kind: 'filing'|'news'|'earnings'|'contract'|'management'|'macro';
  date: string;
  direction: Direction;
  severity: Severity;
  certainty: 'confirmed'|'reported'|'estimated';
  title: string;
  impactPath: string;        // '매출 경로: HBM 비중↑ → 영업이익률 개선'
  source: EvidenceSource;
}

export interface ProbabilityDistribution {
  symbol: string;
  horizonDays: number;       // 20
  outperformProb: number;    // 시장 초과수익 확률
  maxDrawdown: number;       // -0.14
  medianRange: number;       // ±0.09
  bands: { p: number; low: number; high: number }[]; // 68/95 cones
  eventMarkers: { date: string; label: string }[];
  disclaimer: string;        // 확률이며 보장 아님 — 항상 렌더
}

export interface ThesisHypothesis {
  id: string;
  text: string;
  status: 'confirmed'|'watch'|'unverified'|'broken';
  evidenceNote: string;
}
export interface ThesisSignal { label: string; value: string; direction: Direction; }
export interface KillCriterion { text: string; status: 'safe'|'approaching'|'triggered'; }
export interface ThesisEvidence { positive: number; negative: number; unverified: number; }
export interface ThesisChange {
  date: string;
  kind: 'auto'|'user_edit'|'created';
  scoreBefore?: number; scoreAfter?: number;
  reason: string;
}
export interface InvestmentThesis {
  id: string;
  symbol: string;
  rawText: string;           // 사용자가 쓴 원문 — 항상 인용 표시
  createdAt: string;
  version: number;
  healthScore: number;       // LLM이 임의 결정 금지 — 계산값
  healthTrend: Trend;
  healthHistory: { date: string; score: number }[];
  hypotheses: ThesisHypothesis[];
  signals: ThesisSignal[];
  killCriteria: KillCriterion[];
  evidence: ThesisEvidence;
  changes: ThesisChange[];
}

export interface Scenario {
  id: string;
  rawQuery: string;          // '원/달러 환율이 10% 하락하면?'
  parsed: {
    variable: string;
    from: string;
    to: string;
    horizon: string;
    impactItems?: string;    // '수출매출 · 외화부채'
  };
  templateId?: string;
  symbol?: string;           // 분석 대상 종목
  title?: string;            // 결과 헤더 타이틀 '환율 −10%'
  badge?: string;            // 대상 변수 배지 'USD/KRW 1,280'
  parseConfidence?: number;  // 인식 신뢰도 0..1
}

// 프레임 03 — 빠른 시나리오 템플릿 (선택 시 입력+구조화 동시 변경)
export interface ScenarioTemplate {
  id: string;
  label: string;             // '환율'
  valueLabel: string;        // '−10%'
  rawQuery: string;          // 입력창에 채울 자연어
  parsed: Scenario['parsed'];
  title: string;
  badge: string;
}

export interface ScenarioDelta { label: string; before: string | number; after: string | number; direction: Direction; }
export interface ScenarioImpactItem {
  label: string;             // '영업이익'
  pct: number;               // 바 크기 0..1
  valueText: string;         // '−8.4%' | '혼합'
  direction: Direction;
}
export interface ScenarioResult {
  scenarioId: string;
  symbol?: string;           // or portfolio-wide
  conclusion: string;        // 1-2문장 AI 핵심 결론 — 화면 최상단
  conclusionHighlights?: Highlight[];
  transmissionPath: { step: string; effect: string; direction: Direction }[];
  transmissionNote?: string; // 경로 아래 보조 설명
  deltas: ScenarioDelta[];   // 상태 74→63, 초과수익 61%→49% ...
  impacts?: ScenarioImpactItem[]; // 영향받는 재무 항목
  affectedCompanies: { symbol: string; name: string; impact: string; direction: Direction }[];
  portfolioImpact?: { summary: string; exposureLabel: string; exposurePct: number };
  confidence: Confidence;
  asOf: string;
}

export interface RiskFactor { label: string; exposure: number; severity: Severity; linkedSymbols: string[]; }
export interface PortfolioHolding {
  symbol: string;
  name: string;
  qty: number;
  avgPrice: number;
  note?: string;         // 매수 이유 — 논제 작성 유도 (프레임 20)
  purchasedAt?: string;  // 매입일 (YYYY-MM-DD, 선택)
}
export interface Portfolio {
  totalValue: number;
  holdings: PortfolioHolding[];
  readOnly: boolean;         // 증권사 연결은 조회 전용
}
export interface PortfolioRisk {
  headline: string;          // '보유 종목은 12개지만 핵심 위험 요인은 4개입니다'
  factors: RiskFactor[];
  allocation: { label: string; weight: number }[];
  concentrationHHI: number;
  var95: number;
  avgCorrelation: number;
  suggestion: string;        // Scenario Lab 유도 문구
  suggestionHighlights?: Highlight[];
  asOf: string;
}

export interface EvidenceSource {
  id: string;
  kind: 'filing'|'transcript'|'consensus'|'news'|'flow';
  title: string;             // 'DART · 1Q26 분기보고서'
  date: string;
  excerpt?: string;          // 원문 발췌 — 인용 블록으로 렌더
  url?: string;
  caveat?: string;           // '확정 실적 아님'
}
export interface AppNotification {
  id: string;
  // P2 확장: risk(위험 경고) · data(데이터 업데이트) 추가 — 알림 설정 6종과 1:1
  kind: 'contradiction'|'reinforcement'|'event'|'regime'|'risk'|'data';
  symbol?: string;
  thesisId?: string;
  time: string;
  headline: string;          // 충돌: '발언 vs 데이터' 대비 구조
  detail?: string;
  detailHighlights?: Highlight[];
  sources?: string;
  thesisImpact?: number;     // -4 등
  importance?: Severity;     // 알림 중요도
  evidenceCount?: number;    // 관련 근거 수
  read?: boolean;            // 읽음 상태 — 서비스가 로컬 저장과 병합해 반환
}

export interface ManagementCommitment {
  text: string;
  status: 'achieved'|'delayed'|'withdrawn';
  note: string;              // '4Q25' | '2분기 지연'
  announcedQ?: string;       // 발표 분기
  resultQ?: string;          // 결과 확인 분기
  source?: string;           // 관련 출처 (컨퍼런스콜/공시)
}
export interface ManagementRecord {
  symbol: string;
  fulfillmentRate: number;   // 0.64
  quarters: number;
  peerAverage: number;
  goalsTracked?: number;     // 추적한 목표 수 (표시는 대표 기록만)
  statusCounts?: { achieved: number; delayed: number; withdrawn: number };
  commitments: ManagementCommitment[];
  languageShift: { assertive: number; conditional: number; note: string }; // QoQ %p
  guidanceConsistency: { label: string; rate: number }[];
  asOf?: string;             // 데이터 기준일
  // 톤 주의: 평가/비난이 아닌 발언-실적 일치 '기록'
}

// ── P2 — Discover (프레임 08) ─────────────────────────────────────────────
export interface DiscoverSignal {
  id: string;
  symbol?: string;           // 실제 종목이면 Company Twin 이동 가능
  name: string;
  sector: string;
  badge: string;             // '수급 이상 · 3.2σ' | '괴리 확대'
  tone: 'accent' | 'warn' | 'neg' | 'pos';
  title: string;             // 'LS일렉트릭 — 뉴스 없는 대량 매집'
  detail: string;            // 감지 이유
  recommendReason: string;   // 개인화: 내 포트폴리오/논제와의 관련성
  recommendReasonHighlights?: Highlight[];
}
export interface IndustryTwin {
  name: string;              // '반도체 · 업황 회복 중반'
  score: number;             // 상태 76
  direction: Direction;
}
export interface NarrativeGapItem {
  label: string;             // 'A사 (AI 테마)' — 원본 익명 표기 유지
  symbol?: string;           // 실종목만 이동 가능
  narrativeScore: number;    // 91
  revenueEvidence: number;   // 34
}

// ── P2 — 프로필·설정 (프레임 25) ─────────────────────────────────────────
export interface UserProfile {
  name: string;
  email: string;
  joinedAt: string;          // '2026.03'
  plan: string;              // 'PRO'
  interests: string[];       // 투자 관심 산업
}
export interface AppSettings {
  changeColorMode: 'international' | 'korean'; // 등락 색상 (국제형/국내형)
  numberUnit: 'won' | 'manwon';                // 숫자 단위 표시
  returnDisplay: 'pct' | 'amount';             // 수익률 표시
  language: 'ko';                              // 언어 (표시 준비)
  animationsEnabled: boolean;                  // 앱 내 애니메이션 (Reduce Motion과 별개)
}
export interface NotificationSettings {
  contradiction: boolean;    // 논제 충돌 (우선)
  reinforcement: boolean;    // 논제 강화·지표 업데이트
  event: boolean;            // 기업 이벤트
  regime: boolean;           // 시장 국면 변화
  data: boolean;             // 데이터 업데이트
  risk: boolean;             // 위험 경고
}
