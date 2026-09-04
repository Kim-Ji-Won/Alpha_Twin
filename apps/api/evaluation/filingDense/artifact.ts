import { canonicalJson, canonicalSha256 } from './canonical.js';
import { DENSE_EVAL_RESULT_SCHEMA, DenseEvalRunRecord, DenseEvaluationError } from './contracts.js';

export interface DenseBenchmarkReproducibility {
  readonly gitSha: string;
  readonly datasetVersion: string;
  readonly devDatasetHash: string;
  readonly holdoutDatasetHash: string;
  readonly benchmarkConfigVersion: string;
  readonly benchmarkConfigHash: string;
  readonly profiles: readonly {
    readonly profileId: string;
    readonly profileFingerprint: string;
    readonly requestedModel: string;
    readonly responseModel: string;
  }[];
  readonly postgresqlVersion: string;
  readonly pgvectorVersion: string;
  readonly host: {
    readonly os: string;
    readonly architecture: string;
    readonly cpuModel: string;
    readonly cpuCount: number;
    readonly memoryBytes: string;
  };
  readonly pricingSnapshotId: string;
  readonly startedAt: string;
  readonly completedAt: string;
}

export interface DenseBenchmarkResultPayload {
  readonly schemaVersion: typeof DENSE_EVAL_RESULT_SCHEMA;
  readonly reproducibility: DenseBenchmarkReproducibility;
  readonly runs: readonly DenseEvalRunRecord[];
  readonly failures: readonly { readonly queryId: string; readonly code: string; readonly category: string }[];
  readonly decision: 'NOT_RUN' | 'LARGE_CANDIDATE_WINNER' | 'SMALL_OR_HOLD' | 'INCONCLUSIVE';
}

export interface DenseBenchmarkResultEnvelope {
  readonly payload: DenseBenchmarkResultPayload;
  readonly canonicalHash: string;
}

const FORBIDDEN_KEYS = new Set([
  'query', 'querytext', 'question', 'history', 'vector', 'vectors', 'rawvector',
  'embedding', 'embeddings', 'apikey', 'authorization', 'headers', 'rawproviderbody',
  'rawresponse', 'databaseurl', 'prompt', 'context', 'hostname', 'username', 'homepath',
  'filepath', 'userpath',
]);

function assertPrivateFieldsAbsent(value: unknown): void {
  if (typeof value === 'string' && ['API_KEY_SENTINEL', 'RAW_VECTOR_SENTINEL', 'PRIVATE_QUERY_SENTINEL']
    .some(sentinel => value.includes(sentinel))) {
    throw new DenseEvaluationError('ARTIFACT_PRIVATE_VALUE');
  }
  if (Array.isArray(value)) {
    for (const item of value) assertPrivateFieldsAbsent(item);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLocaleLowerCase('en-US'))) {
      throw new DenseEvaluationError('ARTIFACT_PRIVATE_FIELD');
    }
    assertPrivateFieldsAbsent(item);
  }
}

export function createResultArtifact(payload: DenseBenchmarkResultPayload): DenseBenchmarkResultEnvelope {
  if (payload.schemaVersion !== DENSE_EVAL_RESULT_SCHEMA) throw new DenseEvaluationError('ARTIFACT_VERSION_INVALID');
  assertPrivateFieldsAbsent(payload);
  return { payload, canonicalHash: canonicalSha256(payload) };
}

export function serializeResultArtifact(artifact: DenseBenchmarkResultEnvelope): string {
  if (artifact.payload.schemaVersion !== DENSE_EVAL_RESULT_SCHEMA) {
    throw new DenseEvaluationError('ARTIFACT_VERSION_INVALID');
  }
  if (canonicalSha256(artifact.payload) !== artifact.canonicalHash) {
    throw new DenseEvaluationError('ARTIFACT_HASH_MISMATCH');
  }
  assertPrivateFieldsAbsent(artifact);
  return canonicalJson(artifact);
}

export function deriveResultCsv(artifact: DenseBenchmarkResultEnvelope): string {
  const rows = ['queryId,split,profileId,status,hitAt10,mrrAt10,ndcgAt10'];
  for (const run of artifact.payload.runs) {
    const cells = [run.queryId, run.split, run.profileId, run.status,
      run.metrics?.hitAt10 ?? '', run.metrics?.reciprocalRankAt10 ?? '', run.metrics?.ndcgAt10 ?? ''];
    rows.push(cells.map(value => `"${String(value).replaceAll('"', '""')}"`).join(','));
  }
  return rows.join('\n');
}

export function deriveDecisionMarkdown(artifact: DenseBenchmarkResultEnvelope): string {
  const valid = artifact.payload.runs.filter(run => run.status === 'valid').length;
  return [
    '# Dense Benchmark Decision',
    '',
    `- Artifact: \`${artifact.canonicalHash}\``,
    `- Decision: \`${artifact.payload.decision}\``,
    `- Valid runs: ${valid}`,
    `- Invalid runs: ${artifact.payload.runs.length - valid}`,
  ].join('\n');
}
