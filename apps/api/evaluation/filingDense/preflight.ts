import { canonicalSha256 } from './canonical.js';
import { DENSE_EVAL_CRITICAL_CATEGORIES, DenseEvalDatasetEnvelope } from './contracts.js';
import { assessDatasetReadiness, evaluateDatasetCoverage } from './dataset.js';
import { isTrustedBenchmarkTarget, TrustedBenchmarkTargetEvidence } from './verifyBenchmarkTarget.js';

export interface LiveCallBudget {
  readonly enabled: boolean;
  readonly explicitlyApproved: boolean;
  readonly maxOpenAiCalls: number;
  readonly maxInputTokens: number;
  readonly maxEstimatedCostAtomicUnits: bigint;
}

export const DEFAULT_LIVE_CALL_BUDGET: LiveCallBudget = Object.freeze({
  enabled: false,
  explicitlyApproved: false,
  maxOpenAiCalls: 0,
  maxInputTokens: 0,
  maxEstimatedCostAtomicUnits: 0n,
});

export interface BenchmarkPreflightInput {
  readonly dev: DenseEvalDatasetEnvelope;
  readonly holdout: DenseEvalDatasetEnvelope;
  readonly registeredProfiles: readonly { readonly profileId: string; readonly profileFingerprint: string }[];
  readonly requiredProfileIds: readonly [string, string];
  readonly database: TrustedBenchmarkTargetEvidence | null;
  readonly liveBudget: LiveCallBudget;
  readonly pricingSnapshotProvided: boolean;
  readonly benchmarkConfigValid: boolean;
  readonly hostMetadataAvailable: boolean;
  readonly largeCalibrationStatus: 'verified' | 'not_verified';
  readonly bothProfilesFullScopeReady: boolean;
  readonly performanceFixtureCandidateRows: number;
}

export function runBenchmarkPreflight(input: BenchmarkPreflightInput) {
  const reasons: string[] = [];
  const readiness = assessDatasetReadiness(input.dev, input.holdout);
  if (!readiness.ready) reasons.push(...readiness.reasons);
  const coverage = evaluateDatasetCoverage([...input.dev.payload.entries, ...input.holdout.payload.entries]);
  for (const category of DENSE_EVAL_CRITICAL_CATEGORIES) {
    if (coverage.categories[category] === 0) reasons.push(`CRITICAL_CATEGORY_EMPTY:${category}`);
  }
  const profiles = new Set(input.registeredProfiles.map(profile => profile.profileId));
  for (const profile of input.requiredProfileIds) if (!profiles.has(profile)) reasons.push(`PROFILE_NOT_REGISTERED:${profile}`);
  if (new Set(input.registeredProfiles.map(profile => profile.profileFingerprint)).size !== input.registeredProfiles.length) {
    reasons.push('PROFILE_FINGERPRINT_COLLISION');
  }
  const database = isTrustedBenchmarkTarget(input.database) ? input.database : null;
  if (!database) reasons.push('PRODUCTION_DATABASE_GUARD');
  if (!input.liveBudget.enabled || !input.liveBudget.explicitlyApproved
    || !Number.isSafeInteger(input.liveBudget.maxOpenAiCalls)
    || !Number.isSafeInteger(input.liveBudget.maxInputTokens)
    || input.liveBudget.maxOpenAiCalls <= 0 || input.liveBudget.maxInputTokens <= 0
    || input.liveBudget.maxEstimatedCostAtomicUnits <= 0n) reasons.push('LIVE_BUDGET_NOT_APPROVED');
  if (!input.pricingSnapshotProvided) reasons.push('PRICING_SNAPSHOT_MISSING');
  if (!input.benchmarkConfigValid) reasons.push('BENCHMARK_CONFIG_INVALID');
  if (!input.hostMetadataAvailable) reasons.push('HOST_METADATA_MISSING');
  if (input.largeCalibrationStatus !== 'verified') reasons.push('LARGE_CALIBRATION_NOT_VERIFIED');
  if (!input.bothProfilesFullScopeReady) reasons.push('PROFILE_SCOPE_NOT_READY');
  if (input.performanceFixtureCandidateRows < 40_000) reasons.push('PERFORMANCE_FIXTURE_BELOW_40K');
  return {
    ready: reasons.length === 0,
    reasons: [...new Set(reasons)],
    datasetHashes: { dev: input.dev.canonicalHash, holdout: input.holdout.canonicalHash },
    configHash: canonicalSha256({
      requiredProfileIds: input.requiredProfileIds,
      database,
      liveBudget: { ...input.liveBudget, maxEstimatedCostAtomicUnits: input.liveBudget.maxEstimatedCostAtomicUnits.toString() },
      performanceFixtureCandidateRows: input.performanceFixtureCandidateRows,
    }),
  };
}
