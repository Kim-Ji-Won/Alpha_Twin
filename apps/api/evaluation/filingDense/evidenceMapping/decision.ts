import { DECISION_RULE, EVIDENCE_SCHEMA, requireEvidence, type DecisionContext,
  type DirectionalRelationKey, type ReceiptDecision, type ReceiptObservation, type ReceiptPlan,
  type RelationDecision, type TemporalAssessment } from './contracts.js';
import { fingerprint, parseInstant, sortedUnique, validKey } from './input.js';

function observed(o: ReceiptObservation): TemporalAssessment['observations'][number] {
  const response = o.source.response;
  if (response.bodyReceivedAt !== null) return { id: o.id, at: response.bodyReceivedAt, phase: 'body-complete' };
  if (o.source.kind === 'list-all' && o.source.request.provenance === 'legacy-collection-contract') {
    return { id: o.id, at: response.headersObservedAt, phase: 'response-headers-observed' };
  }
  return { id: o.id, at: null, phase: 'missing' };
}
function temporal(observations: ReceiptObservation[], context: DecisionContext): TemporalAssessment {
  const evaluated = parseInstant(context.evaluatedAt)!;
  const selected = observations.filter(o => o.identity === 'exact' && o.state === 'exact');
  const recorded = selected.map(observed);
  const reasons: string[] = [];
  const ages: Record<string, number | null> = {};
  const instants: number[] = [], finals: number[] = [];
  for (const o of selected) {
    const { at } = observed(o), instant = parseInstant(at);
    const start = parseInstant(o.source.request.startedAt), headers = parseInstant(o.source.response.headersObservedAt);
    const body = parseInstant(o.source.response.bodyReceivedAt);
    if (at === null || o.source.request.startedAt === null) reasons.push('TIME_MISSING');
    else if (instant === null || start === null) reasons.push('TIME_INVALID');
    for (const value of [o.source.response.headersObservedAt, o.source.response.bodyReceivedAt]) {
      if (value !== null && parseInstant(value) === null) reasons.push('TIME_INVALID');
    }
    if (start !== null && ((headers !== null && start > headers) || (body !== null && start > body))
      || (headers !== null && body !== null && headers > body)) reasons.push('TIME_REVERSED');
    if ([start, headers, body, instant].some(t => t !== null && t > evaluated)) reasons.push('TIME_IN_FUTURE');
    ages[o.id] = instant === null ? null : evaluated - instant;
    if (instant !== null) {
      instants.push(instant);
      if (o.facts.providerFinal === 'positive') finals.push(evaluated - instant);
    }
  }
  const complete = ['list-all', 'list-final', 'viewer-main'].every(kind => selected.some(o => o.source.kind === kind));
  const completeness = reasons.length ? 'invalid-time' : complete ? 'complete' : 'missing-required-observation';
  const skewMs = instants.length ? Math.max(...instants) - Math.min(...instants) : null;
  const providerFinalAgeMs = finals.length ? Math.max(...finals) : null;
  let outcome: TemporalAssessment['outcome'] = 'NOT_EVALUATED';
  if (context.policy.kind === 'simulation') {
    outcome = completeness !== 'complete' || providerFinalAgeMs === null || skewMs === null ? 'NOT_EVALUABLE'
      : providerFinalAgeMs > context.policy.maxFinalAgeMs ? 'EXPIRED'
        : skewMs > context.policy.maxSkewMs ? 'SKEW_EXCEEDED' : 'WITHIN_LIMITS';
  }
  return { completeness, observations: recorded, ageMsByObservation: ages, providerFinalAgeMs, skewMs,
    policyStatus: context.policy.kind === 'simulation' ? 'POLICY_SIMULATION' : 'POLICY_NOT_APPROVED',
    outcome, reasons: sortedUnique(reasons), enforcement: 'NOT_CONNECTED' };
}
function receipt(plan: ReceiptPlan, all: ReceiptObservation[], context: DecisionContext): ReceiptDecision {
  const observations = all.filter(o => o.source.target.receipt === plan.target.receipt);
  const reasons = observations.flatMap(o => o.reasons);
  const conflicting = observations.some(o => fingerprint(o.source.target) !== fingerprint(plan.target)
    || o.identity === 'conflicting');
  const usable = observations.filter(o => fingerprint(o.source.target) === fingerprint(plan.target));
  const n = usable.filter(o => o.source.kind === 'list-all');
  const y = usable.filter(o => o.source.kind === 'list-final');
  const v = usable.filter(o => o.source.kind === 'viewer-main');
  const positive = y.filter(o => o.facts.providerFinal === 'positive');
  const negative = usable.filter(o => o.identity === 'exact' && (o.facts.explicitNonFinalWarning === 'observed'
    || o.facts.withdrawalRemark === 'observed' || o.facts.subsequentCorrectionRemark === 'observed'));
  let conflict = conflicting;
  if (conflicting) reasons.push('IDENTITY_MISMATCH');
  if (plan.finalQuery === 'not-requested' && y.length) { conflict = true; reasons.push('ACQUISITION_PLAN_CONFLICT'); }
  if (positive.length && negative.length) {
    conflict = true;
    const sameTime = positive.some(p => negative.some(neg => parseInstant(observed(p).at) !== null
      && parseInstant(observed(p).at) === parseInstant(observed(neg).at)));
    reasons.push(sameTime ? 'STATUS_CONFLICT' : 'TEMPORAL_CONFLICT_REVIEW');
  }
  // Keep simultaneous conflicting metadata instead of allowing array order/latest-wins to decide.
  const metadata = (o: ReceiptObservation) => fingerprint({ state: o.state, identity: o.identity,
    report: o.rawReportName, remarks: o.rawRemarks, facts: o.facts,
    pagination: o.pagination, exactReceiptMatchCount: o.exactReceiptMatchCount });
  for (const left of usable) for (const right of usable) {
    const leftInstant = parseInstant(observed(left).at), rightInstant = parseInstant(observed(right).at);
    if (left.id < right.id && left.source.kind === right.source.kind
      && leftInstant !== null && leftInstant === rightInstant && metadata(left) !== metadata(right)) {
      conflict = true; reasons.push('STATUS_CONFLICT');
    }
  }
  const precedence = ['malformed', 'ambiguous', 'unavailable', 'incomplete', 'absent-in-this-response'] as const;
  const final = plan.finalQuery === 'not-requested' && !y.length ? 'not-requested'
    : precedence.find(state => y.some(o => o.state === state)) ?? (positive.length ? 'positive' : 'unavailable');
  if (final === 'not-requested') reasons.push('FINAL_QUERY_NOT_REQUESTED');
  if (final === 'unavailable') reasons.push('FINAL_SOURCE_UNAVAILABLE');
  const time = temporal(usable, context);
  reasons.push(...time.reasons, 'LEGAL_MAPPING_POLICY_NOT_APPROVED', 'ROOT_REFERENCE_NOT_OBSERVED',
    'EXTERNAL_COMPLETENESS_UNPROVEN', 'FRESHNESS_ENFORCEMENT_NOT_IMPLEMENTED');
  if (time.completeness !== 'complete') reasons.push('TEMPORAL_INPUT_INCOMPLETE');
  const invalid = usable.some(o => o.state === 'malformed' || o.state === 'ambiguous');
  return { target: structuredClone(plan.target), evaluatedAt: context.evaluatedAt, ruleVersion: DECISION_RULE,
    evidenceIds: sortedUnique(observations.map(o => o.source.id)), observationIds: sortedUnique(observations.map(o => o.id)),
    identity: conflicting ? 'conflicting' : [...n, ...y].some(o => o.identity === 'exact') ? 'exact' : 'unproven',
    providerFinal: final, explicitNonFinal: v.some(o => o.facts.explicitNonFinalWarning === 'observed') ? 'observed'
      : v.length > 0 && v.every(o => o.state === 'exact') ? 'not-observed' : 'not-assessable',
    withdrawal: [...new Set(usable.map(o => o.facts.withdrawalRemark))].sort(),
    subsequentCorrection: [...new Set(usable.map(o => o.facts.subsequentCorrectionRemark))].sort(),
    sourceStates: observations.map(o => ({ id: o.source.id, state: o.state })),
    contradictions: conflict ? 'review-required' : 'none-observed-in-scope', temporal: time,
    root: 'UNPROVEN', lineageCompleteness: 'UNPROVEN', policyAcceptance: 'POLICY_NOT_APPROVED',
    disposition: conflict || invalid ? 'REVIEW_REQUIRED' : 'HELD_UNPROVEN', reasons: sortedUnique(reasons),
    unknowns: ['approved legal/status policy', 'external chain completeness', 'root authority'],
    nextActions: ['review unsupported or conflicting evidence; no persistence plan', 'obtain separately approved root evidence'] };
}

export function decideEvidence(plans: readonly ReceiptPlan[], raw: readonly ReceiptObservation[],
  relations: readonly DirectionalRelationKey[], context: DecisionContext) {
  requireEvidence(parseInstant(context.evaluatedAt) !== null, 'EVALUATED_AT_INVALID');
  requireEvidence(context.policy.kind === 'not-approved' || context.policy.kind === 'simulation', 'POLICY_NOT_APPROVED');
  if (context.policy.kind === 'simulation') {
    requireEvidence(Object.keys(context.policy).sort().join('|') === 'kind|maxFinalAgeMs|maxSkewMs'
      && [context.policy.maxFinalAgeMs, context.policy.maxSkewMs].every(n => Number.isSafeInteger(n) && n >= 0), 'SIMULATION_PARAMETERS_REQUIRED');
  } else requireEvidence(Object.keys(context.policy).length === 1, 'POLICY_NOT_APPROVED');
  requireEvidence(plans.length <= 100 && raw.length <= 1000 && relations.length <= 100, 'INPUT_TOO_LARGE');
  plans.forEach(p => { validKey(p.target); requireEvidence(['requested', 'not-requested'].includes(p.finalQuery), 'SCHEMA_INVALID'); });
  requireEvidence(new Set(plans.map(p => p.target.receipt)).size === plans.length, 'DUPLICATE_TARGET');
  const aliases = new Map<string, string>(), unique = new Map<string, ReceiptObservation>();
  for (const o of [...raw].sort((a, b) => a.source.id < b.source.id ? -1 : a.source.id > b.source.id ? 1 : 0)) {
    requireEvidence(plans.some(p => p.target.receipt === o.source.target.receipt), 'IDENTITY_MISMATCH');
    requireEvidence(!aliases.has(o.source.id) || aliases.get(o.source.id) === fingerprint(o), 'EVIDENCE_ID_CONFLICT');
    aliases.set(o.source.id, fingerprint(o));
    if (!unique.has(o.id)) unique.set(o.id, o);
    else {
      const existing = unique.get(o.id)!;
      const comparable = (x: ReceiptObservation) => ({ ...x, source: { ...x.source, id: '' }, evidence: x.evidence.map(e => ({ ...e, artifactId: '' })) });
      requireEvidence(fingerprint(comparable(existing)) === fingerprint(comparable(o)), 'EVIDENCE_ID_CONFLICT');
    }
  }
  const observations = [...unique.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const receipts = [...plans].sort((a, b) => a.target.receipt.localeCompare(b.target.receipt)).map(p => receipt(p, observations, context));
  const relationResults: RelationDecision[] = relations.map((key): RelationDecision => {
    requireEvidence(key.relation === 'corrects' && key.fromReceipt !== key.toReceipt, 'RELATION_KEY_INVALID');
    const from = receipts.find(r => r.target.receipt === key.fromReceipt), to = receipts.find(r => r.target.receipt === key.toReceipt);
    requireEvidence(from && to, 'RELATION_ENDPOINT_MISSING');
    const sameCompany = from.target.corpCode === to.target.corpCode && from.target.symbol === to.target.symbol;
    const viewers = observations.filter(o => [key.fromReceipt, key.toReceipt].includes(o.source.target.receipt) && o.source.kind === 'viewer-main');
    const left = viewers.filter(o => o.source.target.receipt === key.fromReceipt);
    const right = viewers.filter(o => o.source.target.receipt === key.toReceipt);
    const exact = viewers.every(o => o.state === 'exact' && o.identity === 'exact');
    const sets = viewers.map(o => o.facts.familyMembers.join('|'));
    const same = left.length > 0 && right.length > 0 && exact && new Set(sets).size === 1
      && viewers.every(o => o.facts.familyMembers.includes(key.fromReceipt) && o.facts.familyMembers.includes(key.toReceipt));
    const conflict = !sameCompany || from.identity === 'conflicting' || to.identity === 'conflicting'
      || (left.length > 0 && right.length > 0 && exact && !same);
    return { key: { ...key }, evaluatedAt: context.evaluatedAt, ruleVersion: DECISION_RULE,
      evidenceIds: sortedUnique([...from.evidenceIds, ...to.evidenceIds]),
      endpointIdentity: !sameCompany || from.identity === 'conflicting' || to.identity === 'conflicting' ? 'conflicting'
        : from.identity === 'exact' && to.identity === 'exact' ? 'exact-both' : 'unproven',
      sameFamily: conflict ? 'conflicting' : same ? 'observed' : 'unproven',
      explicitDirectedReference: 'UNPROVEN', root: 'UNPROVEN', completeness: 'UNPROVEN', policyAcceptance: 'POLICY_NOT_APPROVED',
      disposition: conflict ? 'REVIEW_REQUIRED' : 'HELD_UNPROVEN',
      reasons: sortedUnique(['EXPLICIT_PREDECESSOR_NOT_OBSERVED', 'ROOT_REFERENCE_NOT_OBSERVED',
        'EXTERNAL_COMPLETENESS_UNPROVEN', 'NO_RELATION_ACCEPTANCE_POLICY',
        same ? 'SAME_FAMILY_IS_NOT_DIRECT_EDGE' : conflict ? 'FAMILY_EVIDENCE_CONFLICT' : 'FAMILY_EVIDENCE_INCOMPLETE']),
      unknowns: ['root authority', 'immediate predecessor reference', 'external chain completeness'],
      nextActions: ['retain unproven; explicit relation source profile requires separate review'] };
  }).sort((a, b) => `${a.key.fromReceipt}:${a.key.toReceipt}`.localeCompare(`${b.key.fromReceipt}:${b.key.toReceipt}`));
  return { schemaVersion: EVIDENCE_SCHEMA, evaluatedAt: context.evaluatedAt, extractionRuleVersion: 'opendart-preserved-profile@1',
    decisionRuleVersion: DECISION_RULE, policyApproval: 'POLICY_NOT_APPROVED' as const,
    mode: structuredClone(context.policy), receipts, relations: relationResults };
}
