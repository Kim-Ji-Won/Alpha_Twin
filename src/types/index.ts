// ALPHA TWIN — domain types. Every screen renders exactly these shapes.
export type Direction = 'positive' | 'negative' | 'mixed' | 'neutral';
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
}

export interface MarketRegime {
  label: string;             // '저변동성 상승 국면'
  probability: number;       // 유지 확률 0..1
  probabilityTrend: Trend;
  riskLevel: Severity;
  sentiment: string;
  volatility: string;
  asOf: string;              // ISO datetime — ALWAYS displayed
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
}

export interface CompanyEvent {
  id: string;
  symbol: string;
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
  parsed: { variable: string; from: string; to: string; horizon: string };
  templateId?: string;
}
export interface ScenarioDelta { label: string; before: string | number; after: string | number; direction: Direction; }
export interface ScenarioResult {
  scenarioId: string;
  symbol?: string;           // or portfolio-wide
  conclusion: string;        // 1-2문장 AI 핵심 결론 — 화면 최상단
  transmissionPath: { step: string; effect: string; direction: Direction }[];
  deltas: ScenarioDelta[];   // 상태 74→63, 초과수익 61%→49% ...
  affectedCompanies: { symbol: string; name: string; impact: string; direction: Direction }[];
  confidence: Confidence;
  asOf: string;
}

export interface RiskFactor { label: string; exposure: number; severity: Severity; linkedSymbols: string[]; }
export interface PortfolioHolding { symbol: string; name: string; qty: number; avgPrice: number; note?: string; }
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
export interface Evidence {
  sources: EvidenceSource[];
  asOf: string;
  confidence: Confidence;
  unverifiedAreas: string[];
  modelAttribution: { label: string; weight: number }[]; // ML/DL/sentiment
}
export interface AIAnalysis {
  id: string;
  question: string;
  conclusion: string;        // bold 핵심 결론
  keyReasons: string;
  counterCase: string;       // 반대 가능성 — 필수 섹션
  dataPoints: { label: string; value: string; direction: Direction }[];
  evidence: Evidence;
  followUps: string[];
}

export interface AppNotification {
  id: string;
  kind: 'contradiction'|'reinforcement'|'event'|'regime';
  symbol?: string;
  thesisId?: string;
  time: string;
  headline: string;          // 충돌: '발언 vs 데이터' 대비 구조
  detail?: string;
  sources?: string;
  thesisImpact?: number;     // -4 등
}

export interface ManagementCommitment {
  text: string;
  status: 'achieved'|'delayed'|'withdrawn';
  note: string;              // '4Q25' | '2분기 지연'
}
export interface ManagementRecord {
  symbol: string;
  fulfillmentRate: number;   // 0.64
  quarters: number;
  peerAverage: number;
  commitments: ManagementCommitment[];
  languageShift: { assertive: number; conditional: number; note: string }; // QoQ %p
  guidanceConsistency: { label: string; rate: number }[];
  // 톤 주의: 평가/비난이 아닌 발언-실적 일치 '기록'
}
