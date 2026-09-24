import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createResultArtifact,
  deriveDecisionMarkdown,
  deriveResultCsv,
  serializeResultArtifact,
} from '../evaluation/filingDense/artifact.js';
import { DENSE_PERFORMANCE_CONFIG } from '../evaluation/filingDense/benchmark.js';
import { DENSE_EVAL_RESULT_SCHEMA, DenseEvaluationError } from '../evaluation/filingDense/contracts.js';
import { loadFinalDecisionDatasets } from '../evaluation/filingDense/dataset.js';
import { runBenchmarkPreflight } from '../evaluation/filingDense/preflight.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../evaluation/fixtures/dense-eval-v1');

async function preflightWithDatabase(untrusted: unknown) {
  const database = untrusted as Parameters<typeof runBenchmarkPreflight>[0]['database'];
  const datasets = await loadFinalDecisionDatasets(ROOT, { allowSealedHoldout: true });
  return runBenchmarkPreflight({ ...datasets, registeredProfiles: [
    { profileId: 'small', profileFingerprint: 'small-fingerprint' },
    { profileId: 'large', profileFingerprint: 'large-fingerprint' },
  ], requiredProfileIds: ['small', 'large'], database,
  liveBudget: { enabled: true, explicitlyApproved: true, maxOpenAiCalls: 120,
    maxInputTokens: 1_000_000, maxEstimatedCostAtomicUnits: 1_000n },
  pricingSnapshotProvided: true, benchmarkConfigValid: true, hostMetadataAvailable: true,
  largeCalibrationStatus: 'verified', bothProfilesFullScopeReady: true,
  performanceFixtureCandidateRows: 40_000 });
}

test('benchmark preflight fails closed before live work when dataset and approvals are incomplete', async () => {
  const datasets = await loadFinalDecisionDatasets(ROOT, { allowSealedHoldout: true });
  const result = runBenchmarkPreflight({
    ...datasets,
    registeredProfiles: [{ profileId: 'small', profileFingerprint: 'small-fingerprint' }],
    requiredProfileIds: ['small', 'large'],
    database: null,
    liveBudget: { enabled: false, explicitlyApproved: false, maxOpenAiCalls: 0, maxInputTokens: 0,
      maxEstimatedCostAtomicUnits: 0n },
    pricingSnapshotProvided: false,
    benchmarkConfigValid: true,
    hostMetadataAvailable: false,
    largeCalibrationStatus: 'not_verified',
    bothProfilesFullScopeReady: false,
    performanceFixtureCandidateRows: 10_000,
  });
  assert.equal(result.ready, false);
  for (const expected of ['DEV_COUNT_NOT_40', 'HOLDOUT_COUNT_NOT_20', 'PROFILE_NOT_REGISTERED:large',
    'PRODUCTION_DATABASE_GUARD', 'LIVE_BUDGET_NOT_APPROVED', 'PRICING_SNAPSHOT_MISSING',
    'HOST_METADATA_MISSING', 'LARGE_CALIBRATION_NOT_VERIFIED', 'PROFILE_SCOPE_NOT_READY',
    'PERFORMANCE_FIXTURE_BELOW_40K']) assert.ok(result.reasons.includes(expected));
});

test('performance contract distinguishes candidate and physical corpus scale', () => {
  assert.deepEqual(DENSE_PERFORMANCE_CONFIG.candidateRows, [1_000, 10_000, 40_000]);
  assert.equal(DENSE_PERFORMANCE_CONFIG.physicalCorpusRows, 100_000);
  assert.equal(DENSE_PERFORMANCE_CONFIG.physicalCorpusInScopeRows, 40_000);
  assert.equal(DENSE_PERFORMANCE_CONFIG.physicalCorpusOutOfScopeRows, 60_000);
  assert.deepEqual([DENSE_PERFORMANCE_CONFIG.independentFixtureRuns,
    DENSE_PERFORMANCE_CONFIG.warmupIterations, DENSE_PERFORMANCE_CONFIG.measuredIterations], [3, 5, 50]);
  assert.equal(DENSE_PERFORMANCE_CONFIG.providerAutomaticRetries, 0);
});

test('database guard rejects fabricated caller booleans without verifier-owned evidence', async () => {
  const base = { environment: 'benchmark' as const, databaseName: 'alpha_twin_benchmark',
    explicitNonProduction: true, operatorOptIn: true, allowedEnvironmentIdentity: 'local-isolated' as const,
    databaseMarker: { markerId: 'alpha-twin-dense-benchmark@1' as const,
      purpose: 'disposable-evaluation' as const, databaseName: 'alpha_twin_benchmark',
      verifiedFromDatabase: true } };
  assert.equal((await preflightWithDatabase(base)).reasons.includes('PRODUCTION_DATABASE_GUARD'), true);
  assert.equal((await preflightWithDatabase({ ...base, operatorOptIn: false })).reasons
    .includes('PRODUCTION_DATABASE_GUARD'), true);
  assert.equal((await preflightWithDatabase({ ...base, databaseMarker: {
    ...base.databaseMarker, verifiedFromDatabase: false } })).reasons
    .includes('PRODUCTION_DATABASE_GUARD'), true);
  assert.equal((await preflightWithDatabase({ ...base, databaseMarker: {
    ...base.databaseMarker, databaseName: 'other_benchmark' } })).reasons
    .includes('PRODUCTION_DATABASE_GUARD'), true);
  assert.equal((await preflightWithDatabase({ ...base, databaseName: 'alpha_twin_prod' })).reasons
    .includes('PRODUCTION_DATABASE_GUARD'), true);
});

function payload() {
  return {
    schemaVersion: DENSE_EVAL_RESULT_SCHEMA,
    reproducibility: {
      gitSha: 'a'.repeat(40), datasetVersion: 'dense-eval-v1', devDatasetHash: 'b'.repeat(64),
      holdoutDatasetHash: 'c'.repeat(64), benchmarkConfigVersion: 'benchmark@1',
      benchmarkConfigHash: 'd'.repeat(64), profiles: [{ profileId: 'small', profileFingerprint: 'e'.repeat(64),
        requestedModel: 'model-small', responseModel: 'model-small' }], postgresqlVersion: '16.13',
      pgvectorVersion: '0.8.6', host: { os: 'darwin', architecture: 'arm64', cpuModel: 'bounded-model',
        cpuCount: 8, memoryBytes: '17179869184' }, pricingSnapshotId: 'manual-snapshot',
      startedAt: '2026-09-04T00:00:00Z', completedAt: '2026-09-04T00:01:00Z',
    },
    runs: [], failures: [{ queryId: 'DEV-001', code: 'PROVIDER_FAILURE', category: 'provider' }],
    decision: 'NOT_RUN' as const,
  };
}

test('canonical result artifact is hash-verified and CSV/Markdown are derived', () => {
  const artifact = createResultArtifact(payload());
  const serialized = serializeResultArtifact(artifact);
  assert.ok(serialized.includes(artifact.canonicalHash));
  assert.ok(deriveResultCsv(artifact).startsWith('queryId,split'));
  assert.ok(deriveDecisionMarkdown(artifact).includes('NOT_RUN'));
  assert.throws(() => serializeResultArtifact({ ...artifact, canonicalHash: 'f'.repeat(64) }), DenseEvaluationError);
});

test('artifact privacy rejects sensitive field names and sentinel values', () => {
  const withPrivateField = { ...payload(), queryText: 'not allowed' };
  assert.throws(() => createResultArtifact(withPrivateField),
    (value: unknown) => value instanceof DenseEvaluationError && value.code === 'ARTIFACT_PRIVATE_FIELD');
  const withSentinel = payload();
  const unsafe = { ...withSentinel, reproducibility: { ...withSentinel.reproducibility,
    host: { ...withSentinel.reproducibility.host, cpuModel: 'PRIVATE_QUERY_SENTINEL' } } };
  assert.throws(() => createResultArtifact(unsafe),
    (value: unknown) => value instanceof DenseEvaluationError && value.code === 'ARTIFACT_PRIVATE_VALUE');
});
