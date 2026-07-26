import {
  FinancialStatementLineDto,
  FinancialStatementsResponseDto,
} from '../contracts.js';
import {
  CANONICAL_FINANCIAL_METRICS,
  CANONICAL_FINANCIAL_REGISTRY,
  CanonicalMetricDefinition,
  FinancialAmountSelectionRule,
} from './canonicalFinancialMetrics.js';
import {
  CanonicalFinancialMetric,
  ConflictedFinancialMetric,
  FinancialMetricCandidateSummary,
  FinancialMetricConflictReason,
  FinancialMetricMatchedBy,
  FinancialNormalizationWarning,
  FinancialNormalizationWarningCode,
  NormalizedFinancialMetric,
  NormalizedFinancialMetrics,
  NormalizedFinancialSummaryDto,
  ResolvedFinancialMetric,
  UnresolvedFinancialMetric,
} from './normalizationContracts.js';

const MATCH_RANK: Record<FinancialMetricMatchedBy, number> = {
  'standard-account-id': 300,
  'approved-account-id-alias': 200,
  'approved-account-name-alias': 100,
};
const STATEMENT_ORDER = ['IS', 'CIS', 'BS', 'CF', 'SCE'] as const;
const MAX_CANDIDATE_SUMMARIES = 5;

interface MatchedCandidate {
  line: FinancialStatementLineDto;
  matchedBy: FinancialMetricMatchedBy;
  rank: number;
  selection: FinancialAmountSelectionRule;
  value: string | null;
}

function normalizedName(value: string): string {
  return value.trim().normalize('NFC');
}

function matchMethod(
  line: FinancialStatementLineDto,
  definition: CanonicalMetricDefinition,
): FinancialMetricMatchedBy | null {
  if (
    line.accountIdKind === 'standard'
    && line.accountId != null
    && definition.standardAccountIds.includes(line.accountId)
  ) return 'standard-account-id';
  if (
    line.accountId != null
    && definition.approvedAccountIdAliases.includes(line.accountId)
  ) return 'approved-account-id-alias';
  if (
    ['missing', 'standard-code-unused'].includes(line.accountIdKind)
    && definition.approvedAccountNameAliases.includes(normalizedName(line.accountName))
  ) return 'approved-account-name-alias';
  return null;
}

function candidateOrder(left: MatchedCandidate, right: MatchedCandidate): number {
  const statement = STATEMENT_ORDER.indexOf(left.line.statementType)
    - STATEMENT_ORDER.indexOf(right.line.statementType);
  if (statement !== 0) return statement;
  return [
    left.line.accountId ?? '',
    normalizedName(left.line.accountName),
    left.line.accountDetail ?? '',
  ].join(':').localeCompare([
    right.line.accountId ?? '',
    normalizedName(right.line.accountName),
    right.line.accountDetail ?? '',
  ].join(':'));
}

function candidateIdentity(candidate: MatchedCandidate): string {
  const matchIdentity = candidate.matchedBy === 'approved-account-name-alias'
    ? normalizedName(candidate.line.accountName)
    : candidate.line.accountId ?? '';
  return [
    candidate.matchedBy,
    matchIdentity,
    candidate.line.accountDetail ?? '',
    candidate.selection.sourceField,
    candidate.selection.basis,
    candidate.value ?? '<null>',
    candidate.line.currency ?? '<null>',
  ].join('\u0000');
}

function summary(candidate: MatchedCandidate): FinancialMetricCandidateSummary {
  return {
    statementType: candidate.line.statementType,
    accountId: candidate.line.accountId,
    accountIdKind: candidate.line.accountIdKind,
    accountName: candidate.line.accountName,
    hasAccountDetail: candidate.line.accountDetail != null,
    matchedBy: candidate.matchedBy,
  };
}

function summaries(candidates: MatchedCandidate[]): FinancialMetricCandidateSummary[] {
  return candidates.slice(0, MAX_CANDIDATE_SUMMARIES).map(summary);
}

function conflictReason(candidates: MatchedCandidate[]): FinancialMetricConflictReason {
  if (new Set(candidates.map(candidate => candidate.line.accountDetail ?? '<null>')).size > 1) {
    return 'dimension-conflict';
  }
  const values = new Set(candidates.map(candidate => candidate.value ?? '<null>'));
  const currencies = new Set(candidates.map(candidate => candidate.line.currency ?? '<null>'));
  if (values.size > 1 || currencies.size > 1) return 'value-conflict';
  if (candidates.every(candidate => candidate.matchedBy === 'standard-account-id')) {
    return 'multiple-standard-account-matches';
  }
  if (new Set(candidates.map(candidate => candidate.line.statementType)).size > 1) {
    return 'statement-conflict';
  }
  return 'multiple-alias-matches';
}

function validateRegistry(definitions: readonly CanonicalMetricDefinition[]): void {
  const metrics = definitions.map(definition => definition.metric);
  if (
    definitions.length !== CANONICAL_FINANCIAL_METRICS.length
    || new Set(metrics).size !== CANONICAL_FINANCIAL_METRICS.length
    || CANONICAL_FINANCIAL_METRICS.some(metric => !metrics.includes(metric))
  ) {
    throw new Error('Canonical financial registry must define exactly eight unique metrics');
  }
}

function addWarning(
  warnings: Map<FinancialNormalizationWarningCode, Set<CanonicalFinancialMetric>>,
  code: FinancialNormalizationWarningCode,
  metric: CanonicalFinancialMetric,
): void {
  const metrics = warnings.get(code) ?? new Set<CanonicalFinancialMetric>();
  metrics.add(metric);
  warnings.set(code, metrics);
}

export class FinancialAccountNormalizer {
  constructor(
    private readonly definitions: readonly CanonicalMetricDefinition[] =
      CANONICAL_FINANCIAL_REGISTRY,
  ) {
    validateRegistry(definitions);
  }

  normalize(response: FinancialStatementsResponseDto): NormalizedFinancialSummaryDto {
    const warnings = new Map<
      FinancialNormalizationWarningCode,
      Set<CanonicalFinancialMetric>
    >();
    const resolved = Object.fromEntries(this.definitions.map(definition => [
      definition.metric,
      this.resolveMetric(response, definition, warnings),
    ])) as unknown as NormalizedFinancialMetrics;

    const warningOrder: FinancialNormalizationWarningCode[] = [
      'METRIC_UNRESOLVED',
      'METRIC_CONFLICT',
      'MISSING_METRIC_CURRENCY',
      'DUPLICATE_EQUIVALENT_CANDIDATE',
    ];
    const normalizedWarnings: FinancialNormalizationWarning[] = warningOrder.flatMap(code => {
      const metrics = warnings.get(code);
      return metrics
        ? [{
          code,
          metrics: CANONICAL_FINANCIAL_METRICS.filter(metric => metrics.has(metric)),
        }]
        : [];
    });

    return {
      symbol: response.symbol,
      corpCode: response.corpCode,
      report: { ...response.report },
      metrics: resolved,
      warnings: normalizedWarnings,
      metadata: {
        ...response.metadata,
        staleReasons: [...response.metadata.staleReasons],
      },
    };
  }

  private resolveMetric(
    response: FinancialStatementsResponseDto,
    definition: CanonicalMetricDefinition,
    warnings: Map<FinancialNormalizationWarningCode, Set<CanonicalFinancialMetric>>,
  ): NormalizedFinancialMetric {
    const selection = definition.selectionByPeriod[response.report.periodKind];
    const matches: MatchedCandidate[] = [];
    for (const line of response.lines) {
      if (!definition.allowedStatementTypes.includes(line.statementType)) continue;
      const matchedBy = matchMethod(line, definition);
      if (!matchedBy) continue;
      matches.push({
        line,
        matchedBy,
        rank: MATCH_RANK[matchedBy],
        selection,
        value: line[selection.sourceField],
      });
    }
    if (matches.length === 0) {
      addWarning(warnings, 'METRIC_UNRESOLVED', definition.metric);
      return this.unresolved(definition.metric, 'account-not-found');
    }

    const highestRank = Math.max(...matches.map(candidate => candidate.rank));
    const highest = matches
      .filter(candidate => candidate.rank === highestRank)
      .sort(candidateOrder);
    const candidatesByIdentity = new Map<string, MatchedCandidate>();
    for (const candidate of highest) {
      const identity = candidateIdentity(candidate);
      if (!candidatesByIdentity.has(identity)) {
        candidatesByIdentity.set(identity, candidate);
      }
    }
    const unique = [...candidatesByIdentity.values()];
    if (unique.length < highest.length) {
      addWarning(warnings, 'DUPLICATE_EQUIVALENT_CANDIDATE', definition.metric);
    }
    if (unique.length > 1) {
      addWarning(warnings, 'METRIC_CONFLICT', definition.metric);
      const conflict: ConflictedFinancialMetric = {
        metric: definition.metric,
        status: 'conflict',
        value: null,
        reason: conflictReason(unique),
        candidates: summaries(unique),
      };
      return conflict;
    }

    const candidate = unique[0]!;
    if (candidate.value == null) {
      addWarning(warnings, 'METRIC_UNRESOLVED', definition.metric);
      return this.unresolved(
        definition.metric,
        'amount-missing',
        summaries([candidate]),
      );
    }
    if (candidate.line.currency == null) {
      addWarning(warnings, 'MISSING_METRIC_CURRENCY', definition.metric);
    }
    const metric: ResolvedFinancialMetric = {
      metric: definition.metric,
      status: 'resolved',
      value: candidate.value,
      currency: candidate.line.currency,
      basis: candidate.selection.basis,
      matchedBy: candidate.matchedBy,
      evidence: {
        receiptNumber: candidate.line.receiptNumber,
        statementType: candidate.line.statementType,
        accountId: candidate.line.accountId,
        accountIdKind: candidate.line.accountIdKind,
        accountName: candidate.line.accountName,
        accountDetail: candidate.line.accountDetail,
        sourceField: candidate.selection.sourceField,
        basis: candidate.selection.basis,
        matchedBy: candidate.matchedBy,
        currency: candidate.line.currency,
      },
    };
    return metric;
  }

  private unresolved(
    metric: CanonicalFinancialMetric,
    reason: UnresolvedFinancialMetric['reason'],
    candidates?: FinancialMetricCandidateSummary[],
  ): UnresolvedFinancialMetric {
    return {
      metric,
      status: 'unresolved',
      value: null,
      reason,
      ...(candidates?.length ? { candidates } : {}),
    };
  }
}
