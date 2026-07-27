import {
  AI_CONTEXT_SCHEMA_VERSION,
  AI_PROMPT_VERSION,
  AI_RESPONSE_SCHEMA_VERSION,
  AiAnalystRequestDto,
  AiAnalystResponseDto,
  AiAnalysisPointDto,
  AiModelAnalysis,
  AiProviderOutcome,
  CompanyAnalysisContextResult,
  parseAiModelAnalysis,
} from './contracts.js';
import { CompanyAnalysisContextBuilder } from './contextBuilder.js';
import { AiError, isAiError } from './errors.js';
import { AiObservability } from './observability.js';
import { AiAnalysisProvider } from './provider.js';

const SAFE_REFUSAL_ANSWER =
  '요청하신 방식의 직접적인 판단은 제공할 수 없습니다. 제공된 기업 데이터에 근거한 일반 분석과 확인할 위험 요인은 검토할 수 있습니다.';

function allPoints(analysis: AiModelAnalysis): AiAnalysisPointDto[] {
  return [
    ...analysis.supportingFactors,
    ...analysis.riskFactors,
    ...analysis.uncertainties,
  ];
}

function validateEvidence(
  analysis: AiModelAnalysis,
  context: CompanyAnalysisContextResult,
): string[] {
  const used: string[] = [];
  for (const point of allPoints(analysis)) {
    for (const reference of point.evidenceRefs) {
      if (!context.validReferenceIds.has(reference)) throw new AiError('AI_EVIDENCE_INVALID');
      if (!used.includes(reference)) used.push(reference);
    }
  }
  return used;
}

function historyChars(request: AiAnalystRequestDto): number {
  return request.history?.reduce((total, item) => total + item.content.length, 0) ?? 0;
}

export class AiAnalystService {
  constructor(
    private readonly contextBuilder: CompanyAnalysisContextBuilder,
    private readonly provider: AiAnalysisProvider,
    private readonly timeoutMs: number,
    private readonly now: () => Date = () => new Date(),
    private readonly observability = new AiObservability(),
  ) {}

  get status() {
    return {
      provider: this.provider.id,
      model: this.provider.model,
      reasoningEffort: this.provider.reasoningEffort,
      configured: this.provider.isConfigured(),
      promptVersion: AI_PROMPT_VERSION,
      contextSchemaVersion: AI_CONTEXT_SCHEMA_VERSION,
    };
  }

  setLogger(logger: Parameters<AiObservability['setLogger']>[0]): void {
    this.observability.setLogger(logger);
  }

  async analyze(
    request: AiAnalystRequestDto,
    requestId?: string,
    requestSignal?: AbortSignal,
  ): Promise<AiAnalystResponseDto> {
    if (!this.provider.isConfigured()) throw new AiError('AI_NOT_CONFIGURED');
    const startedAt = Date.now();
    let context: CompanyAnalysisContextResult | undefined;
    let providerOutcome: AiProviderOutcome | undefined;
    try {
      context = await this.contextBuilder.build(request.symbol, requestId);
      const controller = new AbortController();
      const abortFromRequest = () => controller.abort(requestSignal?.reason);
      requestSignal?.addEventListener('abort', abortFromRequest, { once: true });
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new AiError('AI_TIMEOUT'));
          controller.abort(new Error('AI provider timeout'));
        }, this.timeoutMs);
      });
      try {
        providerOutcome = await Promise.race([
          this.provider.analyze({
            contextJson: JSON.stringify(context.context),
            validReferenceIds: [...context.validReferenceIds],
            history: request.history ?? [],
            question: request.question,
          }, controller.signal),
          timeout,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        requestSignal?.removeEventListener('abort', abortFromRequest);
      }

      const analysis = providerOutcome.kind === 'refusal'
        ? this.refusalAnalysis()
        : parseAiModelAnalysis(providerOutcome.analysis);
      if (!analysis) throw new AiError('AI_OUTPUT_SCHEMA_INVALID');
      const usedReferences = validateEvidence(analysis, context);
      const response: AiAnalystResponseDto = {
        schemaVersion: AI_RESPONSE_SCHEMA_VERSION,
        status: analysis.status,
        answer: analysis.answer,
        supportingFactors: analysis.supportingFactors,
        riskFactors: analysis.riskFactors,
        uncertainties: analysis.uncertainties,
        followUpQuestion: analysis.followUpQuestion,
        dataReferences: usedReferences.map(reference => {
          const item = context!.referenceCatalog.get(reference);
          if (!item) throw new AiError('AI_EVIDENCE_INVALID');
          return item;
        }),
        metadata: {
          symbol: context.context.identity.symbol,
          generatedAt: this.now().toISOString(),
          dataAsOf: context.context.dataAsOf,
          availableSources: context.context.availability.availableSources,
          missingSources: context.context.availability.missingSources,
          stale: context.context.availability.staleSources.length > 0,
          staleSources: context.context.availability.staleSources,
        },
      };
      this.record(request, startedAt, context, providerOutcome, response.status, requestId, 'success');
      return response;
    } catch (error) {
      const safe = isAiError(error) ? error : new AiError('AI_PROVIDER_UNAVAILABLE');
      this.record(
        request,
        startedAt,
        context,
        providerOutcome,
        undefined,
        requestId,
        'failure',
        safe,
      );
      throw safe;
    }
  }

  private refusalAnalysis(): AiModelAnalysis {
    return {
      schemaVersion: AI_PROMPT_VERSION,
      status: 'boundary',
      answer: SAFE_REFUSAL_ANSWER,
      supportingFactors: [],
      riskFactors: [],
      uncertainties: [],
      followUpQuestion: null,
    };
  }

  private record(
    request: AiAnalystRequestDto,
    startedAt: number,
    context: CompanyAnalysisContextResult | undefined,
    providerOutcome: AiProviderOutcome | undefined,
    responseStatus: string | undefined,
    requestId: string | undefined,
    outcome: 'success' | 'failure',
    error?: AiError,
  ): void {
    this.observability.record({
      operation: 'ai-analyst',
      provider: this.provider.id,
      model: this.provider.model,
      reasoningEffort: this.provider.reasoningEffort,
      promptVersion: AI_PROMPT_VERSION,
      contextSchemaVersion: AI_CONTEXT_SCHEMA_VERSION,
      symbol: request.symbol,
      availableSources: context?.context.availability.availableSources ?? [],
      missingSources: context?.context.availability.missingSources ?? [],
      staleSources: context?.context.availability.staleSources ?? [],
      questionChars: request.question.length,
      historyMessages: request.history?.length ?? 0,
      historyChars: historyChars(request),
      durationMs: Date.now() - startedAt,
      responseStatus,
      requestId,
      providerRequestId: providerOutcome?.providerRequestId ?? error?.providerRequestId,
      providerStatus: error?.providerStatus,
      providerCode: error?.providerCode,
      usage: providerOutcome?.usage,
      outcome,
    });
  }
}
