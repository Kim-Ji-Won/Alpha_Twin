import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalSha256 } from './canonical.js';
import { parseEvaluationLocator } from './evaluationLocator.js';
import {
  DENSE_EVAL_CATEGORIES,
  DENSE_EVAL_CRITICAL_CATEGORIES,
  DENSE_EVAL_DATASET_ID,
  DENSE_EVAL_DATASET_SCHEMA,
  DenseEvalCategory,
  DenseEvalChunkPin,
  DenseEvalDatasetEnvelope,
  DenseEvalDatasetPayload,
  DenseEvalEntry,
  DenseEvalSplit,
  DenseEvaluationError,
} from './contracts.js';

const HASH = /^[a-f0-9]{64}$/;
const RECEIPT = /^\d{14}$/;
const CORP_CODE = /^\d{8}$/;
const SYMBOL = /^\d{6}$/;
const CATEGORY_SET = new Set<string>(DENSE_EVAL_CATEGORIES);

function record(value: unknown, code = 'DATASET_SCHEMA_INVALID'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DenseEvaluationError(code);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) {
    throw new DenseEvaluationError('DATASET_UNKNOWN_FIELD');
  }
}

function string(value: unknown, code = 'DATASET_SCHEMA_INVALID'): string {
  if (typeof value !== 'string' || value.length === 0) throw new DenseEvaluationError(code);
  return value;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new DenseEvaluationError('DATASET_SCHEMA_INVALID');
  return value.map(item => string(item));
}

function split(value: unknown): DenseEvalSplit {
  if (value !== 'dev' && value !== 'holdout') throw new DenseEvaluationError('DATASET_SPLIT_INVALID');
  return value;
}

function parseChunk(value: unknown): DenseEvalChunkPin {
  const item = record(value);
  exactKeys(item, ['provider', 'corpCode', 'symbol', 'receiptNumber', 'documentId', 'chunkId',
    'contentHash', 'representationFingerprint', 'parserVersion', 'chunkerVersion',
    'schemaVersion', 'sectionPath', 'locator']);
  const locator = parseEvaluationLocator(item.locator);
  const chunk: DenseEvalChunkPin = {
    provider: item.provider === 'opendart-fss' ? item.provider : (() => {
      throw new DenseEvaluationError('DATASET_PROVIDER_INVALID');
    })(),
    corpCode: string(item.corpCode),
    symbol: string(item.symbol),
    receiptNumber: string(item.receiptNumber),
    documentId: string(item.documentId),
    chunkId: string(item.chunkId),
    contentHash: string(item.contentHash),
    representationFingerprint: string(item.representationFingerprint),
    parserVersion: string(item.parserVersion),
    chunkerVersion: string(item.chunkerVersion),
    schemaVersion: string(item.schemaVersion),
    sectionPath: stringArray(item.sectionPath),
    locator,
  };
  if (!CORP_CODE.test(chunk.corpCode) || !SYMBOL.test(chunk.symbol)
    || !RECEIPT.test(chunk.receiptNumber) || !HASH.test(chunk.contentHash)
    || !HASH.test(chunk.representationFingerprint) || chunk.sectionPath.length === 0
    || chunk.sectionPath.length > 16 || chunk.sectionPath.some(part => part.length > 200)) {
    throw new DenseEvaluationError('DATASET_CHUNK_PIN_INVALID');
  }
  return chunk;
}

function parseEntry(value: unknown, expectedSplit: DenseEvalSplit): DenseEvalEntry {
  const item = record(value);
  exactKeys(item, ['queryId', 'split', 'queryText', 'categories', 'company', 'reportFamily',
    'evidenceModality', 'currentEffectiveCorrection', 'evidenceGroups', 'review', 'notes']);
  const actualSplit = split(item.split);
  if (actualSplit !== expectedSplit) throw new DenseEvaluationError('DATASET_SPLIT_MISMATCH');
  const queryId = string(item.queryId);
  const idPattern = actualSplit === 'dev' ? /^DEV-\d{3}$/ : /^HOLD-\d{3}$/;
  if (!idPattern.test(queryId)) throw new DenseEvaluationError('DATASET_QUERY_ID_INVALID');
  const categories = stringArray(item.categories);
  if (categories.length === 0) throw new DenseEvaluationError('DATASET_CATEGORIES_EMPTY');
  if (new Set(categories).size !== categories.length || categories.some(value => !CATEGORY_SET.has(value))) {
    throw new DenseEvaluationError('DATASET_CATEGORY_INVALID');
  }
  const company = record(item.company);
  exactKeys(company, ['corpCode', 'symbol']);
  const corpCode = string(company.corpCode);
  const symbol = string(company.symbol);
  if (!CORP_CODE.test(corpCode) || !SYMBOL.test(symbol)) {
    throw new DenseEvaluationError('DATASET_COMPANY_INVALID');
  }
  if (item.reportFamily !== 'annual' && item.reportFamily !== 'half_year'
    && item.reportFamily !== 'quarterly') {
    throw new DenseEvaluationError('DATASET_REPORT_FAMILY_INVALID');
  }
  if (item.evidenceModality !== 'narrative' && item.evidenceModality !== 'table') {
    throw new DenseEvaluationError('DATASET_MODALITY_INVALID');
  }
  if (typeof item.currentEffectiveCorrection !== 'boolean') {
    throw new DenseEvaluationError('DATASET_CORRECTION_INVALID');
  }
  if (!Array.isArray(item.evidenceGroups)) throw new DenseEvaluationError('DATASET_GROUPS_INVALID');
  const seenGroups = new Set<string>();
  const seenChunks = new Set<string>();
  const evidenceGroups = item.evidenceGroups.map(value => {
    const group = record(value);
    exactKeys(group, ['evidenceGroupId', 'grade', 'acceptableChunks']);
    const evidenceGroupId = string(group.evidenceGroupId);
    if (seenGroups.has(evidenceGroupId)) throw new DenseEvaluationError('DATASET_GROUP_DUPLICATE');
    seenGroups.add(evidenceGroupId);
    if (group.grade !== 1 && group.grade !== 2) throw new DenseEvaluationError('DATASET_GRADE_INVALID');
    if (!Array.isArray(group.acceptableChunks) || group.acceptableChunks.length === 0) {
      throw new DenseEvaluationError('DATASET_GROUP_EMPTY');
    }
    const acceptableChunks = group.acceptableChunks.map(parseChunk);
    for (const chunk of acceptableChunks) {
      const key = chunkKey(chunk);
      if (seenChunks.has(key)) throw new DenseEvaluationError('DATASET_CHUNK_DUPLICATE');
      seenChunks.add(key);
      if (chunk.corpCode !== corpCode || chunk.symbol !== symbol) {
        throw new DenseEvaluationError('DATASET_CHUNK_COMPANY_MISMATCH');
      }
    }
    return { evidenceGroupId, grade: group.grade, acceptableChunks } as const;
  });
  const review = record(item.review);
  exactKeys(review, ['status', 'reviewRoundCount', 'reviewedAt', 'reviewerRoleId']);
  if (review.status !== 'pending' && review.status !== 'reviewed' && review.status !== 'sealed') {
    throw new DenseEvaluationError('DATASET_REVIEW_STATE_INVALID');
  }
  if (!Number.isInteger(review.reviewRoundCount) || Number(review.reviewRoundCount) < 0) {
    throw new DenseEvaluationError('DATASET_REVIEW_ROUNDS_INVALID');
  }
  const reviewStatus = review.status as 'pending' | 'reviewed' | 'sealed';
  const reviewRoundCount = Number(review.reviewRoundCount);
  if ((reviewStatus === 'pending' && reviewRoundCount !== 0)
    || (reviewStatus === 'reviewed' && reviewRoundCount < 1)
    || (reviewStatus === 'sealed' && reviewRoundCount < 2)) {
    throw new DenseEvaluationError('DATASET_REVIEW_EVIDENCE_INVALID');
  }
  if (reviewStatus !== 'pending' && evidenceGroups.length === 0) {
    throw new DenseEvaluationError('DATASET_REVIEWED_WITHOUT_EVIDENCE');
  }
  if (actualSplit === 'dev' && reviewStatus === 'sealed') {
    throw new DenseEvaluationError('DATASET_DEV_SEALED_INVALID');
  }
  if (actualSplit === 'holdout' && reviewStatus === 'reviewed') {
    throw new DenseEvaluationError('DATASET_HOLDOUT_NOT_SEALED');
  }
  assertReviewMetadata(review);
  if ((item.notes !== undefined && typeof item.notes !== 'string')
    || (review.reviewedAt !== undefined && typeof review.reviewedAt !== 'string')
    || (review.reviewerRoleId !== undefined && typeof review.reviewerRoleId !== 'string')) {
    throw new DenseEvaluationError('DATASET_BOUNDED_METADATA_INVALID');
  }
  const queryText = string(item.queryText);
  if (queryText.length > 500 || (typeof item.notes === 'string' && item.notes.length > 500)
    || (typeof review.reviewerRoleId === 'string' && !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(review.reviewerRoleId))
    || (typeof review.reviewedAt === 'string' && !Number.isFinite(Date.parse(review.reviewedAt)))) {
    throw new DenseEvaluationError('DATASET_BOUNDED_METADATA_INVALID');
  }
  return {
    queryId,
    split: actualSplit,
    queryText,
    categories: categories as readonly DenseEvalCategory[],
    company: { corpCode, symbol },
    reportFamily: item.reportFamily as DenseEvalEntry['reportFamily'],
    evidenceModality: item.evidenceModality,
    currentEffectiveCorrection: item.currentEffectiveCorrection,
    evidenceGroups,
    review: {
      status: reviewStatus,
      reviewRoundCount,
      ...(typeof review.reviewedAt === 'string' ? { reviewedAt: review.reviewedAt } : {}),
      ...(typeof review.reviewerRoleId === 'string' ? { reviewerRoleId: review.reviewerRoleId } : {}),
    },
    ...(typeof item.notes === 'string' ? { notes: item.notes } : {}),
  };
}

export function chunkKey(chunk: DenseEvalChunkPin): string {
  return canonicalSha256({
    provider: chunk.provider,
    corpCode: chunk.corpCode,
    symbol: chunk.symbol,
    receiptNumber: chunk.receiptNumber,
    documentId: chunk.documentId,
    chunkId: chunk.chunkId,
    contentHash: chunk.contentHash,
    representationFingerprint: chunk.representationFingerprint,
    parserVersion: chunk.parserVersion,
    chunkerVersion: chunk.chunkerVersion,
    schemaVersion: chunk.schemaVersion,
  });
}

export function parseDatasetEnvelope(value: unknown, expectedSplit: DenseEvalSplit): DenseEvalDatasetEnvelope {
  const envelope = record(value);
  exactKeys(envelope, ['payload', 'canonicalHash']);
  const payload = record(envelope.payload);
  exactKeys(payload, ['datasetId', 'schemaVersion', 'split', 'targetCount', 'entries']);
  if (payload.datasetId !== DENSE_EVAL_DATASET_ID || payload.schemaVersion !== DENSE_EVAL_DATASET_SCHEMA) {
    throw new DenseEvaluationError('DATASET_VERSION_INVALID');
  }
  const actualSplit = split(payload.split);
  if (actualSplit !== expectedSplit) throw new DenseEvaluationError('DATASET_SPLIT_MISMATCH');
  const targetCount = Number(payload.targetCount);
  const expectedTarget = expectedSplit === 'dev' ? 40 : 20;
  if (targetCount !== expectedTarget || !Array.isArray(payload.entries)) {
    throw new DenseEvaluationError('DATASET_TARGET_INVALID');
  }
  const entries = payload.entries.map(item => parseEntry(item, expectedSplit));
  const ids = entries.map(entry => entry.queryId);
  if (new Set(ids).size !== ids.length) throw new DenseEvaluationError('DATASET_QUERY_ID_DUPLICATE');
  const parsed: DenseEvalDatasetPayload = {
    datasetId: DENSE_EVAL_DATASET_ID,
    schemaVersion: DENSE_EVAL_DATASET_SCHEMA,
    split: expectedSplit,
    targetCount,
    entries,
  };
  const hash = string(envelope.canonicalHash, 'DATASET_HASH_INVALID');
  if (!HASH.test(hash) || canonicalSha256(parsed) !== hash) {
    throw new DenseEvaluationError('DATASET_HASH_MISMATCH');
  }
  return { payload: parsed, canonicalHash: hash };
}

async function load(root: string, selected: DenseEvalSplit): Promise<DenseEvalDatasetEnvelope> {
  const path = join(root, selected, 'dataset.json');
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  return parseDatasetEnvelope(parsed, selected);
}

export function loadDevelopmentDataset(root: string): Promise<DenseEvalDatasetEnvelope> {
  return load(root, 'dev');
}

export async function loadFinalDecisionDatasets(
  root: string,
  options: { readonly allowSealedHoldout: boolean },
): Promise<{ readonly dev: DenseEvalDatasetEnvelope; readonly holdout: DenseEvalDatasetEnvelope }> {
  if (!options.allowSealedHoldout) throw new DenseEvaluationError('HOLDOUT_ACCESS_DENIED');
  const [dev, holdout] = await Promise.all([load(root, 'dev'), load(root, 'holdout')]);
  return { dev, holdout };
}

export interface DatasetCoverageReport {
  readonly total: number;
  readonly reviewed: number;
  readonly pending: number;
  readonly sealed: number;
  readonly categories: Readonly<Record<DenseEvalCategory, number>>;
  readonly companyCounts: Readonly<Record<string, number>>;
  readonly reportFamilyCounts: Readonly<Record<DenseEvalEntry['reportFamily'], number>>;
  readonly modalityCounts: Readonly<Record<DenseEvalEntry['evidenceModality'], number>>;
  readonly correctionCount: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export function evaluateDatasetCoverage(entries: readonly DenseEvalEntry[]): DatasetCoverageReport {
  const categories = Object.fromEntries(DENSE_EVAL_CATEGORIES.map(value => [value, 0])) as Record<DenseEvalCategory, number>;
  const companyCounts: Record<string, number> = {};
  const reportFamilyCounts = { annual: 0, half_year: 0, quarterly: 0 };
  const modalityCounts = { narrative: 0, table: 0 };
  let correctionCount = 0;
  let reviewed = 0;
  let pending = 0;
  let sealed = 0;
  for (const entry of entries) {
    for (const category of entry.categories) categories[category] += 1;
    const company = `${entry.company.corpCode}:${entry.company.symbol}`;
    companyCounts[company] = (companyCounts[company] ?? 0) + 1;
    reportFamilyCounts[entry.reportFamily] += 1;
    modalityCounts[entry.evidenceModality] += 1;
    if (entry.currentEffectiveCorrection) correctionCount += 1;
    if (entry.review.status === 'pending') pending += 1;
    if (entry.review.status === 'reviewed') reviewed += 1;
    if (entry.review.status === 'sealed') sealed += 1;
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  if (Object.keys(companyCounts).length < 2) errors.push('COMPANY_MINIMUM_NOT_MET');
  if (entries.length > 0 && Math.max(0, ...Object.values(companyCounts)) / entries.length > 0.6) {
    errors.push('SINGLE_COMPANY_MAXIMUM_EXCEEDED');
  }
  for (const category of DENSE_EVAL_CRITICAL_CATEGORIES) {
    if (categories[category] === 0) errors.push(`CRITICAL_CATEGORY_EMPTY:${category}`);
  }
  for (const category of DENSE_EVAL_CATEGORIES) {
    if (categories[category] === 0 && !DENSE_EVAL_CRITICAL_CATEGORIES.includes(category as typeof DENSE_EVAL_CRITICAL_CATEGORIES[number])) {
      warnings.push(`CATEGORY_EMPTY:${category}`);
    }
  }
  if (correctionCount < 8) warnings.push('CORRECTION_TARGET_NOT_MET');
  if (reportFamilyCounts.annual !== 24 || reportFamilyCounts.half_year !== 12
    || reportFamilyCounts.quarterly !== 24) warnings.push('REPORT_FAMILY_TARGET_NOT_MET');
  if (modalityCounts.narrative !== 30 || modalityCounts.table !== 30) {
    warnings.push('MODALITY_TARGET_NOT_MET');
  }
  return { total: entries.length, reviewed, pending, sealed, categories, companyCounts,
    reportFamilyCounts, modalityCounts, correctionCount, errors, warnings };
}

export function assessDatasetReadiness(
  dev: DenseEvalDatasetEnvelope,
  holdout: DenseEvalDatasetEnvelope,
): { readonly ready: boolean; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  if (dev.payload.entries.length !== 40) reasons.push('DEV_COUNT_NOT_40');
  if (holdout.payload.entries.length !== 20) reasons.push('HOLDOUT_COUNT_NOT_20');
  if (dev.payload.entries.some(entry => entry.review.status !== 'reviewed')) reasons.push('DEV_NOT_FULLY_REVIEWED');
  if (holdout.payload.entries.some(entry => entry.review.status !== 'sealed')) reasons.push('HOLDOUT_NOT_FULLY_SEALED');
  const coverage = evaluateDatasetCoverage([...dev.payload.entries, ...holdout.payload.entries]);
  reasons.push(...coverage.errors);
  return { ready: reasons.length === 0, reasons };
}

export function assertBenchmarkEligible(entry: DenseEvalEntry): void {
  assertReviewMetadata(entry.review);
  if (entry.review.status === 'pending') throw new DenseEvaluationError('PENDING_ANNOTATION');
  if (entry.split === 'holdout' && entry.review.status !== 'sealed') {
    throw new DenseEvaluationError('HOLDOUT_NOT_SEALED');
  }
}

export function assertReviewTransition(
  splitValue: DenseEvalSplit,
  previous: DenseEvalEntry['review'],
  next: DenseEvalEntry['review'],
): void {
  assertReviewMetadata(previous);
  assertReviewMetadata(next);
  if (next.reviewRoundCount < previous.reviewRoundCount) {
    throw new DenseEvaluationError('REVIEW_ROUND_REGRESSION');
  }
  if (previous.status === 'sealed' && next.status !== 'sealed') {
    throw new DenseEvaluationError('SEALED_REVIEW_IMMUTABLE');
  }
  const allowed = splitValue === 'dev'
    ? (previous.status === next.status
      || (previous.status === 'pending' && next.status === 'reviewed'))
    : (previous.status === next.status
      || (previous.status === 'pending' && next.status === 'sealed'));
  if (!allowed || (next.status === 'pending' && next.reviewRoundCount !== 0)
    || (next.status === 'reviewed' && next.reviewRoundCount < 1)
    || (next.status === 'sealed' && next.reviewRoundCount < 2)) {
    throw new DenseEvaluationError('REVIEW_TRANSITION_INVALID');
  }
}

function assertReviewMetadata(review: {
  readonly status?: unknown; readonly reviewedAt?: unknown; readonly reviewerRoleId?: unknown;
}): void {
  if (review.status === 'pending') {
    if (Object.hasOwn(review, 'reviewedAt') || Object.hasOwn(review, 'reviewerRoleId')) {
      throw new DenseEvaluationError('DATASET_REVIEW_EVIDENCE_INVALID');
    }
  } else if (typeof review.reviewedAt !== 'string' || !Number.isFinite(Date.parse(review.reviewedAt))
    || typeof review.reviewerRoleId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(review.reviewerRoleId)) {
    throw new DenseEvaluationError('DATASET_REVIEW_EVIDENCE_INVALID');
  }
}

export function validateCurrentEffectiveEvidence(
  entry: DenseEvalEntry,
  currentChunkKeys: ReadonlySet<string>,
): { readonly compatible: boolean; readonly missingChunkKeys: readonly string[] } {
  const required = entry.evidenceGroups.flatMap(group => group.acceptableChunks.map(chunkKey));
  const missingChunkKeys = required.filter(key => !currentChunkKeys.has(key));
  return { compatible: missingChunkKeys.length === 0, missingChunkKeys };
}

export function findCopiedTokenSequence(query: string, sourceText: string, minimumTokens = 8): boolean {
  if (!Number.isInteger(minimumTokens) || minimumTokens < 2) {
    throw new DenseEvaluationError('LEAKAGE_THRESHOLD_INVALID');
  }
  const tokenize = (value: string) => value.normalize('NFC').toLocaleLowerCase('ko-KR')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  const queryTokens = tokenize(query);
  const sourceTokens = tokenize(sourceText);
  if (queryTokens.length < minimumTokens || sourceTokens.length < minimumTokens) return false;
  const source = sourceTokens.join('\u0000');
  for (let index = 0; index <= queryTokens.length - minimumTokens; index += 1) {
    if (source.includes(queryTokens.slice(index, index + minimumTokens).join('\u0000'))) return true;
  }
  return false;
}

export function requiresLeakageRewrite(
  entry: DenseEvalEntry,
  sourceText: string,
  options: { readonly literalLookupQuestion?: boolean } = {},
): boolean {
  if (entry.categories.includes('numeric') || options.literalLookupQuestion === true) return false;
  return findCopiedTokenSequence(entry.queryText, sourceText, 8);
}
