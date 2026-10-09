import { ActiveCompanyFilingScope } from '../activeScope/contracts.js';
import { AdmissionDenied, AdmissionGuard, requireAdmissionGuard } from '../admission/guard.js';
import { ActiveFilingScopeService } from '../activeScope/activeFilingScopeService.js';
import {
  createOpenAiEmbeddingTokenizer,
  DENSE_COST_LIMITS,
  DenseTokenizer,
} from '../dense/batchPlanner.js';
import {
  classifyDenseFailure,
  DenseFailureCode,
  DenseGenerationError,
  EmbeddingProvider,
  isCompatibleEmbeddingResponseModel,
} from '../dense/embeddingProvider.js';
import { FilingDenseRetrievalRepository } from '../dense/filingDenseRetrievalRepository.js';
import { getFilingDenseProfile } from '../dense/profile.js';
import { FILING_DENSE_RETRIEVAL_BOUNDS } from '../dense/retrievalContracts.js';
import { prepareDenseVector } from '../dense/vector.js';
import {
  ActiveCompanyDenseSearchResult,
  DenseGenerationProvenance,
  SearchActiveCompanyFilingsDenselyInput,
} from './contracts.js';
import { prepareDenseQuery, DENSE_QUERY_FORMATTER_ID } from './denseQueryFormatter.js';
import { ActiveCompanyDenseSearchError } from './errors.js';
import { assertTrustedScopeBinding, hasInjectedAuthority, UTF8_RETRIEVAL_SCOPE_BINDING,
  VerifiedRetrievalScopeBinding } from './scopeBinding.js';

const CORP_CODE = /^\d{8}$/u;
const SYMBOL = /^\d{6}$/u;
const QUERY_INPUT_ID = 'active-company-dense-query';
const NOT_READY_REASONS = new Set([
  'generation_missing', 'generation_building', 'generation_failed',
]);

type ActiveScopeResolver = Pick<ActiveFilingScopeService, 'resolveCompany'>;
type DenseRepository = Pick<FilingDenseRetrievalRepository,
'resolveDenseReadiness' | 'retrieveDenseFilingChunks'>;

function orchestrationError(
  code: ActiveCompanyDenseSearchError['code'],
  retryable = false,
  providerFailureCode?: DenseFailureCode,
): ActiveCompanyDenseSearchError {
  return new ActiveCompanyDenseSearchError(code, retryable, providerFailureCode);
}

function validateStructuralInput(input: SearchActiveCompanyFilingsDenselyInput): number {
  const topK = input.topK ?? FILING_DENSE_RETRIEVAL_BOUNDS.defaultTopK;
  if (typeof input.corpCode !== 'string' || !CORP_CODE.test(input.corpCode)
    || typeof input.symbol !== 'string' || !SYMBOL.test(input.symbol)
    || typeof input.query !== 'string' || typeof input.denseProfileId !== 'string'
    || !Number.isInteger(topK) || topK < 1
    || topK > FILING_DENSE_RETRIEVAL_BOUNDS.maximumTopK
    || hasInjectedAuthority(input)) {
    throw orchestrationError('FILING_ACTIVE_DENSE_SEARCH_INVALID_INPUT');
  }
  return topK;
}

function validateScope(
  scope: ActiveCompanyFilingScope,
  input: SearchActiveCompanyFilingsDenselyInput,
  binding: VerifiedRetrievalScopeBinding,
): void {
  const entryDocumentIds = scope.entries.map(entry => entry.documentId);
  const validEmpty = scope.status === 'empty' && scope.entries.length === 0
    && scope.documentIds.length === 0;
  const validActive = scope.status === 'active' && scope.entries.length > 0
    && scope.documentIds.length <= FILING_DENSE_RETRIEVAL_BOUNDS.maximumDocumentScope
    && new Set(scope.documentIds).size === scope.documentIds.length
    && scope.documentIds.every((documentId, index) => documentId === entryDocumentIds[index]);
  if (scope.corpCode !== input.corpCode || scope.symbol !== input.symbol
    || scope.retrievalPolicyId !== binding.policyId
    || scope.retrievalPolicyFingerprint !== binding.policyFingerprint
    || (!validEmpty && !validActive)) {
    throw orchestrationError('FILING_ACTIVE_DENSE_SEARCH_SCOPE_INTEGRITY_FAILURE');
  }
}

function providerFailure(value: unknown): ActiveCompanyDenseSearchError {
  const failure = classifyDenseFailure(value);
  return orchestrationError('FILING_DENSE_QUERY_EMBEDDING_FAILED',
    failure.retryable, failure.code);
}

export class ActiveCompanyDenseSearchService {
  private readonly tokenizer: DenseTokenizer;

  constructor(
    private readonly activeScope: ActiveScopeResolver,
    private readonly dense: DenseRepository,
    private readonly provider: EmbeddingProvider,
    tokenizer?: DenseTokenizer,
    private readonly monotonicNow: () => number = () => performance.now(),
    private readonly binding: VerifiedRetrievalScopeBinding = UTF8_RETRIEVAL_SCOPE_BINDING,
    private readonly admission?: AdmissionGuard,
  ) {
    assertTrustedScopeBinding(binding);
    this.tokenizer = tokenizer ?? createOpenAiEmbeddingTokenizer();
  }

  static guarded(activeScope: ActiveScopeResolver, dense: DenseRepository, provider: EmbeddingProvider,
    guard: AdmissionGuard, tokenizer?: DenseTokenizer): ActiveCompanyDenseSearchService {
    return new ActiveCompanyDenseSearchService(activeScope, dense, provider, tokenizer,
      () => performance.now(), UTF8_RETRIEVAL_SCOPE_BINDING, requireAdmissionGuard(guard));
  }

  async search(
    input: SearchActiveCompanyFilingsDenselyInput,
  ): Promise<ActiveCompanyDenseSearchResult> {
    const topK = validateStructuralInput(input);
    const profile = getFilingDenseProfile(input.denseProfileId);
    if (!profile || profile.queryFormatterVersion !== DENSE_QUERY_FORMATTER_ID) {
      throw orchestrationError('FILING_ACTIVE_DENSE_SEARCH_INVALID_INPUT');
    }
    // Scope plumbing is not approval to widen immutable dense profile inputs.
    if (this.binding !== UTF8_RETRIEVAL_SCOPE_BINDING) {
      throw orchestrationError('FILING_DENSE_SCOPE_COMPATIBILITY_NOT_APPROVED');
    }
    let scope = await this.activeScope.resolveCompany({
      corpCode: input.corpCode,
      symbol: input.symbol,
      retrievalPolicyId: this.binding.policyId,
    });
    validateScope(scope, input, this.binding);
    const session = this.admission?.session();
    if (session) scope = await session.scope(scope);
    const common = {
      scope,
      denseProfileId: profile.profileId,
      denseProfileFingerprint: profile.profileFingerprint,
      topK,
    } as const;
    if (scope.documentIds.length === 0) {
      return { ...common, status: 'scope_empty', generations: [], candidates: [] };
    }

    if (session) scope = await session.scope(scope);
    const loadedReadiness = await this.dense.resolveDenseReadiness({
      corpCode: input.corpCode,
      symbol: input.symbol,
      documentIds: scope.documentIds,
      denseProfileId: profile.profileId,
    });
    const readiness = session ? structuredClone(loadedReadiness) : loadedReadiness;
    if (session) {
      readiness.generations.forEach(Object.freeze);
      Object.freeze(readiness.generations);
      if (readiness.status === 'not_ready') {
        readiness.reasons.forEach(Object.freeze); Object.freeze(readiness.reasons);
      }
      Object.freeze(readiness);
      scope = await session.scope(scope);
    }
    if (readiness.denseProfileId !== profile.profileId
      || readiness.denseProfileFingerprint !== profile.profileFingerprint) {
      throw orchestrationError('FILING_ACTIVE_DENSE_SEARCH_SCOPE_INTEGRITY_FAILURE');
    }
    if (readiness.status === 'not_ready') {
      const positions = new Map(scope.documentIds.map((documentId, index) => [documentId, index]));
      if (readiness.generations.length !== 0 || readiness.reasons.length === 0
        || new Set(readiness.reasons.map(reason => reason.documentId)).size !== readiness.reasons.length
        || readiness.reasons.some((reason, index) => !NOT_READY_REASONS.has(reason.reason)
          || !positions.has(reason.documentId)
          || (index > 0 && positions.get(readiness.reasons[index - 1]!.documentId)!
            >= positions.get(reason.documentId)!))) {
        throw orchestrationError('FILING_ACTIVE_DENSE_SEARCH_SCOPE_INTEGRITY_FAILURE');
      }
      return { ...common, status: 'dense_not_ready', generations: [],
        reasons: readiness.reasons, candidates: [] };
    }
    if (readiness.generations.length !== scope.documentIds.length
      || new Set(readiness.generations.map(generation => generation.generationId)).size
        !== readiness.generations.length
      || readiness.generations.some((generation, index) =>
        generation.documentId !== scope.documentIds[index])) {
      throw orchestrationError('FILING_ACTIVE_DENSE_SEARCH_SCOPE_INTEGRITY_FAILURE');
    }
    if (session && (new Set(scope.entries.map(entry => entry.documentId)).size !== scope.entries.length
      || scope.entries.length !== readiness.generations.length
      || readiness.generations.some((generation, index) => {
        const entry = scope.entries[index];
        return !entry || generation.documentId !== entry.documentId
          || !/^[a-f0-9]{64}$/.test(generation.representationFingerprint)
          || generation.representationFingerprint !== entry.representationFingerprint;
      }))) {
      throw new AdmissionDenied(['DENSE_REPRESENTATION_MISMATCH']);
    }

    const query = prepareDenseQuery(input.query, this.tokenizer);
    if (session) scope = await session.scope(scope);
    const startedAt = this.monotonicNow();
    let response: Awaited<ReturnType<EmbeddingProvider['embedBatch']>>;
    try {
      response = await this.provider.embedBatch(profile, [{
        inputId: QUERY_INPUT_ID,
        text: query.formatted,
      }]);
    } catch (value) {
      throw providerFailure(value);
    }
    const latencyMs = Math.max(0, this.monotonicNow() - startedAt);
    if (response.provider !== 'openai'
      || !isCompatibleEmbeddingResponseModel(profile.modelId, response.model)
      || response.vectors.length !== 1 || response.vectors[0]?.inputId !== QUERY_INPUT_ID
      || !Number.isInteger(response.tokenCount) || response.tokenCount < 0
      || response.tokenCount > DENSE_COST_LIMITS.maximumTokensPerInput
      || !Number.isFinite(latencyMs)) {
      throw providerFailure(new DenseGenerationError('DENSE_PROVIDER_RESPONSE_INVALID', false));
    }
    let queryVector: readonly number[];
    try {
      queryVector = prepareDenseVector(response.vectors[0].vector).values;
    } catch {
      throw providerFailure(new DenseGenerationError('DENSE_PROVIDER_RESPONSE_INVALID', false));
    }

    const generationProvenance: readonly DenseGenerationProvenance[] = Object.freeze(
      readiness.generations.map(generation => Object.freeze({
        ...generation,
        denseProfileId: profile.profileId,
        denseProfileFingerprint: profile.profileFingerprint,
      })),
    );
    if (session) scope = await session.scope(scope);
    const candidates = await this.dense.retrieveDenseFilingChunks({
      corpCode: input.corpCode,
      symbol: input.symbol,
      denseProfileId: profile.profileId,
      denseProfileFingerprint: profile.profileFingerprint,
      generations: readiness.generations,
      queryVector,
      topK,
    });
    if (session) {
      scope = await session.scope(scope);
      if (candidates.some(c => !scope.entries.some(e => e.documentId === c.documentId
        && e.receiptNumber === c.receiptNumber) || c.provider !== 'opendart-fss' || c.corpCode !== scope.corpCode || c.symbol !== scope.symbol
        || c.denseProfileId !== profile.profileId || !readiness.generations.some(g =>
          g.documentId === c.documentId && g.generationId === c.generationId && g.generationFingerprint === c.generationFingerprint))) {
        throw new AdmissionDenied(['RESULT_TARGET_MISMATCH']);
      }
    }
    const queryEmbedding = Object.freeze({
      provider: response.provider,
      requestedModel: profile.modelId,
      responseModel: response.model,
      queryFormatterId: DENSE_QUERY_FORMATTER_ID,
      preflightTokenCount: query.tokenCount,
      providerTokenCount: response.tokenCount,
      latencyMs,
      dimension: queryVector.length,
    });
    if (candidates.length === 0) {
      return { ...common, status: 'no_matches', generations: generationProvenance,
        queryEmbedding, candidates: [] };
    }
    return { ...common, status: 'matched', generations: generationProvenance,
      queryEmbedding, candidates: [candidates[0]!, ...candidates.slice(1)] };
  }
}
