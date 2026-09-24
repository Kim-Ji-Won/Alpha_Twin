import { Client } from 'pg';
import { BENCHMARK_IDENTITY, BenchmarkFailure, BenchmarkSafetyError, safeBenchmarkFailure } from './benchmarkMarkerContract.js';
import { BenchmarkInventory, beginBenchmarkReadOnly, inspectBenchmarkCorpus, inspectBenchmarkMarker } from './benchmarkInspection.js';
import { closeBenchmarkClient, createBenchmarkClient } from './benchmarkTargetPolicy.js';

const verified = new WeakSet<object>();
export interface TrustedBenchmarkTargetEvidence {
  readonly databaseName: typeof BENCHMARK_IDENTITY.databaseName;
  readonly markerId: typeof BENCHMARK_IDENTITY.markerId;
  readonly purpose: typeof BENCHMARK_IDENTITY.purpose;
  readonly verificationContractVersion: typeof BENCHMARK_IDENTITY.contractRevision;
  readonly readOnlyVerified: true;
  readonly schemaVerified: true;
  readonly inventorySummary: BenchmarkInventory;
}
export function isTrustedBenchmarkTarget(value: unknown): value is TrustedBenchmarkTargetEvidence {
  return typeof value === 'object' && value !== null && verified.has(value);
}
export type BenchmarkVerificationResult =
  | { readonly status: 'BENCHMARK_TARGET_VERIFIED'; readonly evidence: TrustedBenchmarkTargetEvidence }
  | { readonly status: BenchmarkFailure };

export async function verifyBenchmarkTarget(): Promise<BenchmarkVerificationResult> {
  let client: Client | undefined;
  try {
    client = createBenchmarkClient('verify');
    await client.connect();
    await beginBenchmarkReadOnly(client);
    if (await inspectBenchmarkMarker(client) === 'absent') throw new BenchmarkSafetyError('BENCHMARK_MARKER_MISSING');
    const { inventory } = await inspectBenchmarkCorpus(client);
    await client.query('ROLLBACK');
    await client.end();
    client = undefined;
    const evidence: TrustedBenchmarkTargetEvidence = Object.freeze({
      databaseName: BENCHMARK_IDENTITY.databaseName, markerId: BENCHMARK_IDENTITY.markerId,
      purpose: BENCHMARK_IDENTITY.purpose, verificationContractVersion: BENCHMARK_IDENTITY.contractRevision,
      readOnlyVerified: true, schemaVerified: true, inventorySummary: inventory,
    });
    verified.add(evidence);
    return { status: 'BENCHMARK_TARGET_VERIFIED', evidence };
  } catch (error) {
    return { status: safeBenchmarkFailure(error, 'BENCHMARK_CONNECTION_FAILED') };
  } finally { await closeBenchmarkClient(client); }
}
