import { DenseEvaluationError } from './contracts.js';
import { percentileR7 } from './statistics.js';

export const DENSE_PERFORMANCE_CONFIG = Object.freeze({
  version: 'dense-performance@1',
  candidateRows: [1_000, 10_000, 40_000] as const,
  physicalCorpusRows: 100_000,
  physicalCorpusInScopeRows: 40_000,
  physicalCorpusOutOfScopeRows: 60_000,
  scopeDocuments: [1, 5, 20] as const,
  topK: [5, 10, 20] as const,
  independentFixtureRuns: 3,
  warmupIterations: 5,
  measuredIterations: 50,
  providerSamplesPerProfile: 60,
  providerAutomaticRetries: 0,
});

export const HNSW_CONFIG = Object.freeze({
  version: 'dense-hnsw-decision@1',
  parameterMatrix: [
    { m: 8, efConstruction: 64 },
    { m: 16, efConstruction: 64 },
    { m: 16, efConstruction: 128 },
  ] as const,
  efSearch: [40, 100, 200] as const,
  overfetch: [1, 2, 4] as const,
  exactP95TriggerMs: 100,
  exactP99TriggerMs: 200,
  minimumP95Improvement: 0.4,
  minimumRecallAt10: 0.98,
  minimumRecallAt20: 0.95,
  maximumIndexToVectorBytesRatio: 2,
});

export interface DbBenchmarkRun {
  readonly scenarioId: string;
  readonly fixtureRunId: string;
  readonly scopeDocuments: 1 | 5 | 20;
  readonly candidateRows: 1_000 | 10_000 | 40_000;
  readonly physicalRows: number;
  readonly topK: 5 | 10 | 20;
  readonly cacheState: 'warm' | 'cold-ish';
  readonly planningMs: number;
  readonly executionMs: number;
  readonly sharedHitBlocks: number;
  readonly sharedReadBlocks: number;
  readonly tempBlocks: number;
  readonly sortMethod?: string;
  readonly planNodeSummary: readonly string[];
  readonly iteration: number;
}

export interface HnswResourceEvidence {
  readonly buildDurationMs: number;
  readonly indexBytes: bigint;
  readonly vectorRelationBytes: bigint;
  readonly peakPracticalMemoryBytes: bigint;
  readonly blockingObserved: boolean;
  readonly writeFailureCount: number;
}

export interface HnswDecisionInput {
  readonly exact40kRuns?: readonly { readonly p95Ms: number; readonly p99Ms: number }[];
  readonly hnswP95Ms?: number;
  readonly exactP95Ms?: number;
  readonly annExactRecallAt10?: number;
  readonly annExactRecallAt20?: number;
  readonly resources?: HnswResourceEvidence;
}

export type HnswDecision = 'GO' | 'NO_GO' | 'INCONCLUSIVE';

export function decideHnsw(input: HnswDecisionInput): HnswDecision {
  if (!input.exact40kRuns || input.exact40kRuns.length !== 3) return 'INCONCLUSIVE';
  const values = input.exact40kRuns.flatMap(run => [run.p95Ms, run.p99Ms]);
  if (values.some(value => !Number.isFinite(value) || value < 0)) return 'INCONCLUSIVE';
  const triggered = input.exact40kRuns.filter(run =>
    run.p95Ms > HNSW_CONFIG.exactP95TriggerMs || run.p99Ms > HNSW_CONFIG.exactP99TriggerMs).length;
  if (triggered === 0) return 'NO_GO';
  if (triggered < 2 || input.hnswP95Ms === undefined || input.exactP95Ms === undefined
    || input.annExactRecallAt10 === undefined || input.annExactRecallAt20 === undefined
    || !input.resources || input.exactP95Ms <= 0 || input.resources.vectorRelationBytes <= 0n) return 'INCONCLUSIVE';
  if (![input.hnswP95Ms, input.exactP95Ms, input.annExactRecallAt10, input.annExactRecallAt20,
    input.resources.buildDurationMs].every(value => Number.isFinite(value) && value >= 0)
    || input.annExactRecallAt10 > 1 || input.annExactRecallAt20 > 1
    || input.resources.indexBytes < 0n || input.resources.peakPracticalMemoryBytes < 0n
    || !Number.isSafeInteger(input.resources.writeFailureCount)
    || input.resources.writeFailureCount < 0) return 'INCONCLUSIVE';
  const improvement = 1 - input.hnswP95Ms / input.exactP95Ms;
  return improvement >= HNSW_CONFIG.minimumP95Improvement
    && input.annExactRecallAt10 >= HNSW_CONFIG.minimumRecallAt10
    && input.annExactRecallAt20 >= HNSW_CONFIG.minimumRecallAt20
    && input.resources.indexBytes <= BigInt(HNSW_CONFIG.maximumIndexToVectorBytesRatio)
      * input.resources.vectorRelationBytes
    && !input.resources.blockingObserved
    && input.resources.writeFailureCount === 0 ? 'GO' : 'NO_GO';
}

export interface PricingSnapshot {
  readonly snapshotId: string;
  readonly currency: string;
  readonly effectiveAt: string;
  readonly sourceLabel: string;
  readonly atomicUnitName: string;
  readonly atomicUnitsPerCurrencyUnit: bigint;
  readonly priceAtomicUnits: bigint;
  readonly tokensPerPriceUnit: bigint;
}

export interface CostQuantity {
  readonly inputTokens: bigint;
  readonly pricing: PricingSnapshot;
}

function validatePricing(pricing: PricingSnapshot): void {
  if (!pricing.snapshotId || !pricing.currency || !pricing.atomicUnitName
    || pricing.atomicUnitsPerCurrencyUnit <= 0n || pricing.priceAtomicUnits < 0n
    || pricing.tokensPerPriceUnit <= 0n) {
    throw new DenseEvaluationError('COST_PRICING_INVALID');
  }
}

export function estimateInputCostAtomicUnits(tokens: bigint, pricing: PricingSnapshot): bigint {
  validatePricing(pricing);
  if (tokens < 0n) {
    throw new DenseEvaluationError('COST_INPUT_INVALID');
  }
  return (tokens * pricing.priceAtomicUnits + pricing.tokensPerPriceUnit - 1n)
    / pricing.tokensPerPriceUnit;
}

export interface ExactCostRatioResult {
  readonly compatible: boolean;
  readonly withinLimit: boolean;
  readonly limit: number;
  readonly currency: string;
  readonly atomicUnitName: string;
  readonly atomicUnitsPerCurrencyUnit: string;
  readonly numerator: string;
  readonly denominator: string;
}

export function compareExactCostRatio(
  large: CostQuantity,
  small: CostQuantity,
  maximumRatio = 8,
): ExactCostRatioResult {
  validatePricing(large.pricing);
  validatePricing(small.pricing);
  if (large.inputTokens < 0n || small.inputTokens < 0n
    || !Number.isSafeInteger(maximumRatio) || maximumRatio < 1) {
    throw new DenseEvaluationError('COST_INPUT_INVALID');
  }
  const compatible = large.pricing.currency === small.pricing.currency
    && large.pricing.atomicUnitName === small.pricing.atomicUnitName
    && large.pricing.atomicUnitsPerCurrencyUnit === small.pricing.atomicUnitsPerCurrencyUnit;
  const numerator = large.inputTokens * large.pricing.priceAtomicUnits
    * small.pricing.tokensPerPriceUnit;
  const denominator = small.inputTokens * small.pricing.priceAtomicUnits
    * large.pricing.tokensPerPriceUnit;
  const withinLimit = compatible && (denominator === 0n ? numerator === 0n
    : numerator <= BigInt(maximumRatio) * denominator);
  return { compatible, withinLimit, limit: maximumRatio,
    currency: large.pricing.currency, atomicUnitName: large.pricing.atomicUnitName,
    atomicUnitsPerCurrencyUnit: large.pricing.atomicUnitsPerCurrencyUnit.toString(),
    numerator: numerator.toString(), denominator: denominator.toString() };
}

export function summarizeLatency(samples: readonly number[]) {
  return { p50: percentileR7(samples, 0.5), p95: percentileR7(samples, 0.95), p99: percentileR7(samples, 0.99) };
}
