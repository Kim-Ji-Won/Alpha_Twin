import { CanonicalFinancialMetric } from '../openDart/normalization/normalizationContracts.js';

export const AI_PROMPT_VERSION = 'analyst-v1' as const;
export const AI_CONTEXT_SCHEMA_VERSION = 'company-analysis-context-v1' as const;
export const AI_RESPONSE_SCHEMA_VERSION = '1' as const;

export const AI_LIMITS = {
  questionChars: 2_000,
  historyMessages: 6,
  historyMessageChars: 2_000,
  historyTotalChars: 8_000,
  contextChars: 65_536,
  answerChars: 1_200,
  factorTextChars: 400,
  followUpChars: 300,
  supportingFactors: 4,
  riskFactors: 4,
  uncertainties: 3,
  evidenceRefsPerPoint: 5,
} as const;

export type AiAnalysisStatus =
  | 'answered'
  | 'partial'
  | 'insufficient_context'
  | 'boundary';
export type AiContextSource = 'market' | 'profile' | 'financial' | 'disclosures';
export type AiHistoryRole = 'user' | 'assistant';

export interface AiHistoryMessageDto {
  role: AiHistoryRole;
  content: string;
}

export interface AiAnalystRequestDto {
  symbol: string;
  question: string;
  history?: AiHistoryMessageDto[];
}

export interface AiAnalysisPointDto {
  text: string;
  evidenceRefs: string[];
}

export interface AiModelAnalysis {
  schemaVersion: typeof AI_PROMPT_VERSION;
  status: AiAnalysisStatus;
  answer: string;
  supportingFactors: AiAnalysisPointDto[];
  riskFactors: AiAnalysisPointDto[];
  uncertainties: AiAnalysisPointDto[];
  followUpQuestion: string | null;
}

export type AiDataReferenceDto =
  | {
    id: string;
    sourceType: 'market' | 'profile';
    label: string;
    asOf: string | null;
  }
  | {
    id: string;
    sourceType: 'financial';
    label: string;
    asOf: string | null;
    metric: CanonicalFinancialMetric;
    period: string;
  }
  | {
    id: string;
    sourceType: 'disclosure';
    label: string;
    asOf: string | null;
    receiptNumber: string;
    reportName: string;
    receiptDate: string;
  };

export interface AiAnalystResponseDto extends Omit<AiModelAnalysis, 'schemaVersion'> {
  schemaVersion: typeof AI_RESPONSE_SCHEMA_VERSION;
  dataReferences: AiDataReferenceDto[];
  metadata: {
    symbol: string;
    generatedAt: string;
    dataAsOf: {
      market: string | null;
      financialPeriod: string | null;
      latestDisclosureDate: string | null;
    };
    availableSources: AiContextSource[];
    missingSources: AiContextSource[];
    stale: boolean;
    staleSources: AiContextSource[];
  };
}

export interface AiMarketContext {
  symbol: string;
  name: string;
  market: string;
  currency: string;
  price: number;
  change: number;
  changePercent: number;
  asOf: string;
  source: string;
  dataMode: 'eod' | 'realtime' | 'mock' | null;
  stale: boolean;
  priceAdjustment: 'raw' | 'adjusted' | 'unknown' | null;
}

export interface AiProfileContext {
  symbol: string;
  displayName: string;
  legalName: string;
  market: string;
  industryCode: string | null;
  fiscalYearEndMonth: string | null;
  establishedDate: string | null;
}

export interface AiFinancialMetricContext {
  metric: CanonicalFinancialMetric;
  status: 'resolved' | 'unresolved' | 'conflict';
  value: string | null;
  currency?: string | null;
  basis?: string;
  statementType?: string;
  receiptNumber?: string;
  reason?: string;
}

export interface AiFinancialContext {
  symbol: string;
  businessYear: string;
  periodKind: 'Q1' | 'H1' | 'Q3' | 'FY';
  requestedFsDiv: 'CFS' | 'OFS';
  resolvedFsDiv: 'CFS' | 'OFS';
  receiptNumber: string;
  receiptDate: string;
  source: string;
  stale: boolean;
  metrics: AiFinancialMetricContext[];
}

export interface AiDisclosureContext {
  receiptNumber: string;
  symbol: string;
  reportName: string;
  receiptDate: string;
  correctionType: string;
  hasSubsequentCorrection: boolean;
  isWithdrawn: boolean;
  includesConsolidated: boolean;
}

export interface CompanyAnalysisContextPack {
  schemaVersion: typeof AI_CONTEXT_SCHEMA_VERSION;
  identity: {
    symbol: string;
    displayName: string;
    market: string | null;
  };
  availability: {
    availableSources: AiContextSource[];
    missingSources: AiContextSource[];
    staleSources: AiContextSource[];
  };
  market: AiMarketContext | null;
  profile: AiProfileContext | null;
  financial: AiFinancialContext | null;
  disclosures: AiDisclosureContext[];
  dataAsOf: {
    market: string | null;
    financialPeriod: string | null;
    latestDisclosureDate: string | null;
  };
}

export interface CompanyAnalysisContextResult {
  context: CompanyAnalysisContextPack;
  validReferenceIds: ReadonlySet<string>;
  referenceCatalog: ReadonlyMap<string, AiDataReferenceDto>;
}

export interface AiProviderUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
}

export interface AiProviderInput {
  contextJson: string;
  validReferenceIds: string[];
  history: AiHistoryMessageDto[];
  question: string;
  safetyIdentifier?: string;
}

export interface AiProviderResult {
  kind: 'analysis';
  analysis: unknown;
  usage: AiProviderUsage;
  providerRequestId: string | null;
}

export interface AiProviderRefusal {
  kind: 'refusal';
  usage: AiProviderUsage;
  providerRequestId: string | null;
}

export type AiProviderOutcome = AiProviderResult | AiProviderRefusal;

export const AI_MODEL_OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'status',
    'answer',
    'supportingFactors',
    'riskFactors',
    'uncertainties',
    'followUpQuestion',
  ],
  properties: {
    schemaVersion: { type: 'string', enum: [AI_PROMPT_VERSION] },
    status: {
      type: 'string',
      enum: ['answered', 'partial', 'insufficient_context', 'boundary'],
    },
    answer: { type: 'string' },
    supportingFactors: { type: 'array', items: { $ref: '#/$defs/point' } },
    riskFactors: { type: 'array', items: { $ref: '#/$defs/point' } },
    uncertainties: { type: 'array', items: { $ref: '#/$defs/point' } },
    followUpQuestion: { type: ['string', 'null'] },
  },
  $defs: {
    point: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'evidenceRefs'],
      properties: {
        text: { type: 'string' },
        evidenceRefs: { type: 'array', items: { type: 'string' } },
      },
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: string[], required: string[]): boolean {
  const keys = Object.keys(value);
  return keys.every(key => allowed.includes(key)) && required.every(key => keys.includes(key));
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= maximum ? text : null;
}

export function parseAiAnalystRequest(value: unknown): AiAnalystRequestDto | null {
  if (!isRecord(value) || !hasExactKeys(value, ['symbol', 'question', 'history'], ['symbol', 'question'])) {
    return null;
  }
  if (typeof value.symbol !== 'string' || typeof value.question !== 'string') return null;
  const symbol = value.symbol.trim();
  const question = boundedText(value.question, AI_LIMITS.questionChars);
  if (!/^\d{6}$/.test(symbol) || !question) return null;
  if (value.history == null) return { symbol, question };
  if (!Array.isArray(value.history) || value.history.length > AI_LIMITS.historyMessages) return null;
  let totalChars = 0;
  const history: AiHistoryMessageDto[] = [];
  for (const item of value.history) {
    if (!isRecord(item) || !hasExactKeys(item, ['role', 'content'], ['role', 'content'])) return null;
    if (item.role !== 'user' && item.role !== 'assistant') return null;
    const content = boundedText(item.content, AI_LIMITS.historyMessageChars);
    if (!content) return null;
    totalChars += content.length;
    if (totalChars > AI_LIMITS.historyTotalChars) return null;
    history.push({ role: item.role, content });
  }
  return { symbol, question, history };
}

function isPlainText(value: string): boolean {
  return !/<\/?[a-z][^>]*>/i.test(value) && !/\[[^\]]+\]\([^)]+\)/.test(value);
}

function parsePoint(value: unknown, requireEvidence: boolean): AiAnalysisPointDto | null {
  if (!isRecord(value) || !hasExactKeys(value, ['text', 'evidenceRefs'], ['text', 'evidenceRefs'])) return null;
  const text = boundedText(value.text, AI_LIMITS.factorTextChars);
  if (!text || !isPlainText(text) || !Array.isArray(value.evidenceRefs)) return null;
  if (value.evidenceRefs.length > AI_LIMITS.evidenceRefsPerPoint) return null;
  const refs: string[] = [];
  for (const ref of value.evidenceRefs) {
    if (typeof ref !== 'string' || !ref.trim()) return null;
    const normalized = ref.trim();
    if (!refs.includes(normalized)) refs.push(normalized);
  }
  if (requireEvidence && refs.length === 0) return null;
  return { text, evidenceRefs: refs };
}

function parsePoints(value: unknown, maximum: number, requireEvidence: boolean): AiAnalysisPointDto[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const points: AiAnalysisPointDto[] = [];
  for (const item of value) {
    const point = parsePoint(item, requireEvidence);
    if (!point) return null;
    points.push(point);
  }
  return points;
}

export function parseAiModelAnalysis(value: unknown): AiModelAnalysis | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'schemaVersion', 'status', 'answer', 'supportingFactors', 'riskFactors',
    'uncertainties', 'followUpQuestion',
  ], [
    'schemaVersion', 'status', 'answer', 'supportingFactors', 'riskFactors',
    'uncertainties', 'followUpQuestion',
  ])) return null;
  if (value.schemaVersion !== AI_PROMPT_VERSION) return null;
  if (!['answered', 'partial', 'insufficient_context', 'boundary'].includes(String(value.status))) return null;
  const answer = boundedText(value.answer, AI_LIMITS.answerChars);
  const supportingFactors = parsePoints(value.supportingFactors, AI_LIMITS.supportingFactors, true);
  const riskFactors = parsePoints(value.riskFactors, AI_LIMITS.riskFactors, true);
  const uncertainties = parsePoints(value.uncertainties, AI_LIMITS.uncertainties, false);
  const followUpQuestion = value.followUpQuestion === null
    ? null
    : boundedText(value.followUpQuestion, AI_LIMITS.followUpChars);
  if (!answer || !isPlainText(answer) || !supportingFactors || !riskFactors || !uncertainties) return null;
  if (value.followUpQuestion !== null && (!followUpQuestion || !isPlainText(followUpQuestion))) return null;
  const status = value.status as AiAnalysisStatus;
  if (
    (status === 'boundary' || status === 'insufficient_context')
    && (supportingFactors.length > 0 || riskFactors.length > 0)
  ) return null;
  return {
    schemaVersion: AI_PROMPT_VERSION,
    status,
    answer,
    supportingFactors,
    riskFactors,
    uncertainties,
    followUpQuestion,
  };
}
