import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import test from 'node:test';
import type { DecisionContext, ReceiptObservation } from '../evaluation/filingDense/evidenceMapping/contracts.js';
import { decideEvidence } from '../evaluation/filingDense/evidenceMapping/decision.js';
import { extractObservation } from '../evaluation/filingDense/evidenceMapping/extract.js';
import { parseInstant, sha256 } from '../evaluation/filingDense/evidenceMapping/input.js';
import { readCatalogFile } from '../evaluation/filingDense/evidenceMapping/loader.js';
import { FIXTURE_EVALUATED_AT } from '../evaluation/filingDense/evidenceMapping/offlineRunner.js';
import { at, complete, context, html, observe, other, page, plan, row, source, target } from './fixtures/evidenceMapping.js';

const decide = (observations = complete(), ctx = context) => decideEvidence([plan()], observations, [], ctx).receipts[0]!;
const edge = { relation: 'corrects' as const, fromReceipt: target.receipt, toReceipt: other.receipt };
const pair = () => [...complete(target, [target.receipt, other.receipt]), ...complete(other, [target.receipt, other.receipt])];
const changedTime = (kind: 'list-all' | 'list-final' | 'viewer-main', ms: number) => observe(kind, undefined, target, new Date(Date.parse(at) + ms).toISOString());

for (const time of [at, '2026-09-30T18:00:00.000+09:00', '2026-09-30T09:00:00.000+00:00']) {
  test(`V01 viewer report conflict through loader: ${time}`, async () => {
    const text = html().replaceAll('Report', 'Other report');
    const root = await mkdtemp('/private/tmp/alpha-viewer-metadata-test-');
    try {
      await writeFile(`${root}/viewer.html`, text);
      const bytes = await readCatalogFile({ root, files: { 'viewer.html': sha256(text) } }, 'viewer.html');
      const s = source('viewer-main', text, target, time); s.id = 'other-report-viewer';
      const changed = extractObservation(s, bytes), original = complete();
      assert.equal(changed.state, 'exact'); assert.equal(original[2]!.state, 'exact');
      const observations = [...original, changed], result = decide(observations);
      assert.ok(result.reasons.includes('STATUS_CONFLICT'));
      assert.equal(result.disposition, 'REVIEW_REQUIRED'); assert.equal(result.observationIds.length, 4);
      assert.deepEqual(result, decide([...observations].reverse()));
      assert.deepEqual(changed.rawReportName, { state: 'present', value: 'Other report' });
      assert.deepEqual(original[2]!.rawReportName, { state: 'present', value: 'Report' });
      assert.equal(changed.source.rawBodySha256, sha256(bytes));
      assert.equal(changed.source.response.bodyReceivedAt, time);
      assert.ok(changed.evidence.some(e => e.locator.kind === 'html' && e.locator.selector === 'title'));
      assert.ok(changed.evidence.some(e => e.locator.kind === 'html' && e.locator.selector === 'select#family > option'));
      assert.deepEqual(JSON.parse(JSON.stringify(changed)).rawReportName, changed.rawReportName);
    } finally { await rm(root, { recursive: true }); }
  });
}
for (const variant of ['unrelated-bytes', 'whitespace', 'entity', 'same-bytes']) {
  test(`V02 equivalent viewer metadata without false conflict: ${variant}`, () => {
    let text = html();
    if (variant === 'unrelated-bytes') text = text.replace('</body>', '<p>Unrelated display</p></body>');
    if (variant === 'whitespace') text = text.replace('<title>', '<title> \n').replace('</title>', '\n </title>');
    if (variant === 'entity') text = text.replaceAll('Report', 'Rep&#111;rt');
    const s = source('viewer-main', text, target, '2026-09-30T09:00:00.000+00:00'); s.id = 'equivalent-viewer';
    const o = extractObservation(s, Buffer.from(text));
    assert.equal(o.state, 'exact'); assert.deepEqual(o.rawReportName, {state: 'present', value: 'Report'});
    assert.equal(decide([...complete(), o]).contradictions, 'none-observed-in-scope');
    if (variant !== 'same-bytes') assert.notEqual(o.source.rawBodySha256, complete()[2]!.source.rawBodySha256);
  });
}
test('V03 different viewer metadata at one millisecond is not simultaneous; warning conflict remains', () => {
  const s = source('viewer-main', html().replaceAll('Report', 'Other report'), target, '2026-09-30T09:00:00.001Z'); s.id = 'later-viewer';
  const o = extractObservation(s, Buffer.from(html().replaceAll('Report', 'Other report')));
  assert.equal(o.state, 'exact'); assert.equal(decide([...complete(), o]).reasons.includes('STATUS_CONFLICT'), false);
  const warning = observe('viewer-main', html(target, [target.receipt], true));
  assert.ok(decide([...complete().slice(0, 2), warning, o]).reasons.includes('STATUS_CONFLICT'));
});
for (const variant of ['mismatch', 'missing-title', 'empty-title', 'missing-option-title', 'ambiguous-option', 'prefix-only']) {
  test(`V04 missing or inconsistent report metadata cannot be exact: ${variant}`, () => {
    let text = html();
    if (variant === 'mismatch') text = text.replace('title="Report"', 'title="Other"');
    if (variant === 'missing-title') text = text.replace(/<title>.*?<\/title>/, '');
    if (variant === 'empty-title') text = text.replace('/Report/', '//');
    if (variant === 'missing-option-title') text = text.replace('title="Report"', '');
    if (variant === 'ambiguous-option') text = text.replace('<option value="null">', '<option selected value="null">');
    if (variant === 'prefix-only') text = text.replace('/Report/', '/[correction]/').replace('title="Report"', '');
    const o = observe('viewer-main', text);
    assert.notEqual(o.state, 'exact'); assert.equal(o.rawReportName.state, 'missing');
    assert.equal(decide([...complete().slice(0, 2), o]).disposition, 'REVIEW_REQUIRED');
  });
}
test('V05 another receipt and cross-source title conventions are not metadata conflicts', () => {
  const otherViewer = observe('viewer-main', html(other).replaceAll('Report', 'Other report'), other);
  const result = decideEvidence([plan(), plan(other)], [...complete(), ...complete(other).slice(0, 2), otherViewer], [], context);
  assert.ok(result.receipts.every(r => r.contradictions === 'none-observed-in-scope'));
  const obs = complete(); assert.notDeepEqual(obs[0]!.rawReportName, obs[2]!.rawReportName);
  assert.equal(decide(obs).contradictions, 'none-observed-in-scope');
});
test('V06 retain correction prefix and select only current receipt report metadata', () => {
  const text = html(target, [other.receipt, target.receipt]).replace('/Report/', '/[correction]Report/')
    .replace(`value="rcpNo=${other.receipt}"  title="Report"`, `value="rcpNo=${other.receipt}"  title="Unrelated report"`);
  const o = observe('viewer-main', text);
  assert.equal(o.state, 'exact'); assert.deepEqual(o.rawReportName, {state: 'present', value: '[correction]Report'});
  assert.equal(o.facts.selectedReceipt, target.receipt);
});
test('V07 title preservation keeps N/Y identity and filename alias deduplication', () => {
  const obs = complete(), alias = structuredClone(obs[2]!); alias.source.id = 'viewer-alias';
  alias.evidence.forEach(e => { e.artifactId = 'viewer-alias'; });
  assert.notEqual(obs[0]!.id, obs[1]!.id); assert.equal(obs[0]!.source.rawBodySha256, obs[1]!.source.rawBodySha256);
  assert.equal(decide([...obs, alias]).observationIds.length, 3);
});

for (const attr of ['class="warning"', 'class="warning notice"', 'class="notice warning"',
  'class = "warning"', "class = 'warning notice'", 'id="notice" class="warning" data-x=">"']) {
  test(`F1 warning attribute profile: ${attr}`, () => {
    const o = observe('viewer-main', html(target, [target.receipt], true).replace('class="warning"', attr));
    assert.equal(o.state, 'exact'); assert.equal(o.facts.explicitNonFinalWarning, 'observed');
    const r = decide([...complete().slice(0, 2), o]);
    assert.equal(r.disposition, 'REVIEW_REQUIRED'); assert.ok(r.reasons.includes('STATUS_CONFLICT'));
  });
}
for (const attr of ['data-class="warning"', 'class="prewarning"', 'class="warning-notice"']) {
  test(`F1 unrelated attribute is not warning: ${attr}`, () => {
    const o = observe('viewer-main', html(target, [target.receipt], true).replace('class="warning"', attr));
    assert.equal(o.state, 'exact'); assert.equal(o.facts.explicitNonFinalWarning, 'not-observed');
    assert.equal(decide([...complete().slice(0, 2), o]).contradictions, 'none-observed-in-scope');
  });
}
for (const variant of ['unclosed', 'truncated', 'duplicate-attribute', 'duplicate-container', 'unclosed-span']) {
  test(`F1 malformed warning is not absence: ${variant}`, () => {
    let text = html(target, [target.receipt], true);
    if (variant === 'unclosed') text = text.replace('</div>', '');
    if (variant === 'truncated') text = text.slice(0, text.indexOf('</div>'));
    if (variant === 'duplicate-attribute') text = text.replace('class="warning"', 'class="warning" class="notice"');
    if (variant === 'duplicate-container') text = text.replace('</div>', '</div><div class="warning"></div>');
    if (variant === 'unclosed-span') text = text.replace('</span></div>', '</div>');
    const o = observe('viewer-main', text);
    assert.notEqual(o.state, 'exact'); assert.equal(o.facts.explicitNonFinalWarning, 'not-assessable');
    const r = decide([...complete().slice(0, 2), o]);
    assert.equal(r.explicitNonFinal, 'not-assessable'); assert.equal(r.disposition, 'REVIEW_REQUIRED');
    assert.equal(r.contradictions, 'none-observed-in-scope');
    assert.ok(o.reasons.some(reason => r.reasons.includes(reason)));
  });
}
test('F1 intact no-warning and inert similar strings remain absence', () => {
  const warning = '<div class="warning">unrelated</div>';
  const o = observe('viewer-main', html().replace('</body>', `<!--${warning}--><script>${warning}</script><style>${warning}</style></body>`));
  assert.equal(o.state, 'exact'); assert.equal(o.facts.explicitNonFinalWarning, 'not-observed');
});

for (const time of [at, '2026-09-30T18:00:00.000+09:00', '2026-09-30T09:00:00.000+00:00']) {
  test(`F2 simultaneous conflicting metadata: ${time}`, () => {
    const o = observe('list-final', page([{ ...row(), report_nm: 'Conflicting report' }]), target, time);
    o.source.id = 'second-final';
    const obs = [...complete(), o], r = decide(obs);
    assert.ok(r.reasons.includes('STATUS_CONFLICT')); assert.equal(r.disposition, 'REVIEW_REQUIRED');
    assert.deepEqual(r, decide([...obs].reverse())); assert.equal(r.observationIds.length, 4);
    assert.equal(o.source.response.bodyReceivedAt, time);
  });
}
test('F2 equivalent metadata with distinct body formatting is not a conflict', () => {
  const o = observe('list-final', JSON.stringify(JSON.parse(page()), null, 2), target, '2026-09-30T09:00:00.000+00:00');
  o.source.id = 'formatted-final';
  assert.notEqual(o.source.rawBodySha256, complete()[1]!.source.rawBodySha256);
  assert.equal(decide([...complete(), o]).contradictions, 'none-observed-in-scope');
  const z = observe('list-final', JSON.stringify(JSON.parse(page()), null, 2)); z.source.id = 'formatted-z';
  assert.equal(decide([...complete(), z]).contradictions, 'none-observed-in-scope');
});
test('F2 one millisecond differs without suppressing independent warning conflict', () => {
  const o = observe('list-final', page([{ ...row(), report_nm: 'Other' }]), target, '2026-09-30T09:00:00.001Z'); o.source.id = 'later';
  assert.equal(decide([...complete(), o]).reasons.includes('STATUS_CONFLICT'), false);
  const warning = observe('viewer-main', html(target, [target.receipt], true));
  assert.ok(decide([...complete().slice(0, 2), warning, o]).reasons.includes('STATUS_CONFLICT'));
});
for (const time of [null, 'invalid']) {
  test(`F2 missing or invalid instants are not simultaneous: ${time}`, () => {
    const make = (title: string, id: string) => {
      const text = page([{ ...row(), report_nm: title }]), s = source('list-final', text);
      s.id = id; s.request.startedAt = time; s.response.headersObservedAt = time; s.response.bodyReceivedAt = time;
      return extractObservation(s, Buffer.from(text));
    };
    const r = decide([complete()[0]!, complete()[2]!, make('One', 'one'), make('Two', 'two')]);
    assert.equal(r.reasons.includes('STATUS_CONFLICT'), false); assert.notEqual(r.temporal.completeness, 'complete');
  });
}

for (const fields of [{}, {page_no: 1, page_count: 100, total_count: 0, total_page: 0, list: []},
  {page_no: '1', page_count: '100', total_count: '0', total_page: '0', list: []}]) {
  test(`F3 valid optional 013 context: ${JSON.stringify(fields)}`, () => {
    const o = observe('list-final', JSON.stringify({ status: '013', ...fields }));
    assert.equal(o.state, 'absent-in-this-response'); assert.equal(o.pagination, 'complete-for-requested-day');
  });
}
for (const key of ['page_no', 'page_count', 'total_count', 'total_page', 'list']) {
  const values: unknown[] = key === 'list' ? [null, '', 'invalid', 0, {}, [row()]]
    : [null, '', 'invalid', 1.5, -1, Number.MAX_SAFE_INTEGER + 1, true, {}, [], key === 'page_count' ? 99 : 999];
  for (const value of values) test(`F3 rejects explicit ${key}=${JSON.stringify(value)}`, () => {
    const o = observe('list-final', JSON.stringify({ status: '013', [key]: value }));
    assert.equal(o.state, 'malformed'); assert.notEqual(o.pagination, 'complete-for-requested-day');
    const r = decide([complete()[0]!, o, complete()[2]!]);
    assert.equal(r.providerFinal, 'malformed'); assert.ok(r.reasons.includes('MALFORMED_RESPONSE'));
    assert.equal(o.reasons.includes('TARGET_ABSENT'), false);
  });
}
test('F3 audit compound page contradiction remains malformed', () => {
  const o = observe('list-final', JSON.stringify({status: '013', page_no: 999, page_count: 'invalid', total_count: 0, total_page: 0, list: []}));
  assert.equal(o.state, 'malformed'); assert.equal(decide([complete()[0]!, o, complete()[2]!]).providerFinal, 'malformed');
});

test('T01 exact positive identity records facts without legal or writer output', () => {
  const result = decide();
  assert.equal(result.identity, 'exact'); assert.equal(result.providerFinal, 'positive');
  assert.equal(result.temporal.outcome, 'WITHIN_LIMITS'); assert.equal(result.disposition, 'HELD_UNPROVEN');
  assert.equal('legalStatus' in result, false); assert.equal('writerApplication' in result, false);
});
test('T02 ownership, symbol and date mismatch remain conflicting', () => {
  for (const [key, value] of [['corp_code', '00000002'], ['stock_code', '000002'], ['rcept_dt', '20260102']]) {
    const o = observe('list-all', page([{ ...row(), [key!]: value }]));
    assert.equal(o.identity, 'conflicting'); assert.ok(o.reasons.includes('IDENTITY_MISMATCH'));
  }
});
test('T03 duplicate receipt is counted before ownership filtering', () => {
  const o = observe('list-final', page([row(), { ...row(), corp_code: '00000002' }]));
  assert.equal(o.state, 'ambiguous'); assert.equal(o.exactReceiptMatchCount, 2);
});
test('T04 provider and HTTP errors are unavailable, never absent', () => {
  for (const status of ['010', '020']) assert.equal(observe('list-final', JSON.stringify({ status })).state, 'unavailable');
  const text = page(), s = source('list-all', text); s.response.httpStatus = 503;
  assert.equal(extractObservation(s, Buffer.from(text)).state, 'unavailable');
});
test('T05 valid 013 no-result is scoped absence', () => {
  for (const list of [undefined, []]) assert.equal(observe('list-final', JSON.stringify({ status: '013', list })).state, 'absent-in-this-response');
});
test('T06 013 with rows is malformed', () => assert.equal(observe('list-final', page([row()], { status: '013' })).state, 'malformed'));
test('T07 complete target absence is not NOT_REQUESTED', () => {
  assert.equal(observe('list-final', page([row(other)])).state, 'absent-in-this-response');
  assert.equal(observe('list-all', page([])).state, 'absent-in-this-response');
});
test('T08 incomplete pagination preserves hit without positive final acceptance', () => {
  const rows = Array.from({ length: 100 }, (_, i) => i ? { ...row(), rcept_no: `20260101${String(i + 1).padStart(6, '0')}` } : row());
  const o = observe('list-final', page(rows, { total_count: 101, total_page: 2 }));
  assert.equal(o.state, 'incomplete'); assert.equal(o.identity, 'exact'); assert.equal(o.facts.providerFinal, 'incomplete');
});
test('T09 page metadata inconsistencies are malformed', () => {
  for (const overrides of [{ page_no: 2 }, { page_count: 50 }, { total_count: 2 }, { total_page: 2 }, { list: null }]) {
    assert.equal(observe('list-final', page([row()], overrides)).state, 'malformed');
  }
});
test('T10 unrequested, missing artifact and unavailable requests stay distinct', async () => {
  const r = decideEvidence([{ target, finalQuery: 'not-requested' }], complete().filter(o => o.source.kind !== 'list-final'), [], context).receipts[0]!;
  assert.equal(r.providerFinal, 'not-requested'); assert.equal(r.temporal.outcome, 'NOT_EVALUABLE');
  assert.equal(decide(complete().filter(o => o.source.kind !== 'list-final')).providerFinal, 'unavailable');
  assert.equal(observe('list-final', JSON.stringify({ status: '020' })).state, 'unavailable');
  const root = await mkdtemp('/private/tmp/alpha-evidence-test-');
  try { await assert.rejects(readCatalogFile({ root, files: { 'missing.json': 'a'.repeat(64) } }, 'missing.json')); }
  finally { await rm(root, { recursive: true }); }
});
test('T11 correction title is not subsequent correction', () => {
  const o = observe('list-all', page([{ ...row(), report_nm: '[기재정정]Report', rm: '연' }]));
  assert.equal(o.facts.contentCorrectionTitle, 'observed'); assert.equal(o.facts.subsequentCorrectionRemark, 'not-observed-in-field');
});
test('T12 rm flags mean subsequent correction and consolidated part', () => {
  const o = observe('list-all', page([{ ...row(), rm: '정연' }]));
  assert.equal(o.facts.subsequentCorrectionRemark, 'observed'); assert.equal(o.facts.consolidatedPartRemark, 'observed');
});
test('T13 empty, null and missing rm remain distinct and imply no active status', () => {
  const missing = row(); delete missing.rm;
  assert.deepEqual(observe('list-all', page([missing])).rawRemarks, { state: 'missing' });
  assert.deepEqual(observe('list-all', page([{ ...row(), rm: null }])).rawRemarks, { state: 'present', value: null });
  assert.deepEqual(observe('list-all').rawRemarks, { state: 'present', value: '' });
});
test('T14 selected is identity only; attachment, scripts and duplicate family cannot masquerade as family', () => {
  const o = observe('viewer-main');
  assert.equal(o.state, 'exact'); assert.equal(o.facts.providerFinal, 'not-applicable');
  assert.deepEqual(o.facts.familyMembers, [target.receipt]);
  const original = html();
  assert.equal(observe('viewer-main', original.replace('id="family"', 'id="other"')).state, 'malformed');
  assert.equal(observe('viewer-main', original.replace('</body>', '<script>"<select id="family"></select>"</script></body>')).state, 'exact');
  assert.equal(observe('viewer-main', original.replace('</body>', '<select id="family"><option>extra</option></select></body>')).state, 'ambiguous');
  assert.equal(observe('viewer-main', original.replace('<div class="warning">', '<div class="warning"><b>unknown</b>')).facts.explicitNonFinalWarning, 'not-assessable');
});
test('T15 same family two entries do not prove root or direct edge', () => {
  const r = decideEvidence([plan(), plan(other)], pair(), [edge], context).relations[0]!;
  assert.equal(r.sameFamily, 'observed'); assert.equal(r.root, 'UNPROVEN'); assert.equal(r.explicitDirectedReference, 'UNPROVEN');
});
test('T16 unsupported root-labelled text is not a supported explicit reference profile', () => {
  const text = html().replace('</body>', `<a data-root="${other.receipt}">root</a></body>`);
  const result = decide([observe('viewer-main', text), ...complete().slice(0, 2)]);
  assert.equal(result.root, 'UNPROVEN'); assert.ok(result.reasons.includes('ROOT_REFERENCE_NOT_OBSERVED'));
});
test('T17 relation keys preserve direction', () => {
  const reversed = { ...edge, fromReceipt: edge.toReceipt, toReceipt: edge.fromReceipt };
  const result = decideEvidence([plan(), plan(other)], pair(), [edge, reversed], context);
  assert.equal(result.relations.length, 2); assert.notDeepEqual(result.relations[0]!.key, result.relations[1]!.key);
});
test('T18 different receipt final evidence is rejected, N/Y mode cannot be swapped', () => {
  assert.throws(() => decide([observe('list-final', page([row(other)]), other)]), /IDENTITY_MISMATCH/);
  const text = page(), s = source('list-final', text); s.request.parameters.last_reprt_at = 'N';
  assert.throws(() => extractObservation(s, Buffer.from(text)), /SOURCE_CONTEXT_MISMATCH/);
  assert.notEqual(observe('list-all').id, observe('list-final').id);
});
test('T19 same-time positive and explicit withdrawal/non-final conflict', () => {
  for (const bad of [observe('list-all', page([{ ...row(), rm: '철' }])), observe('viewer-main', html(target, [target.receipt], true))]) {
    const result = decide(complete().map(o => o.source.kind === bad.source.kind ? bad : o));
    assert.equal(result.contradictions, 'review-required'); assert.ok(result.reasons.includes('STATUS_CONFLICT'));
  }
});
test('T20 other receipt non-final is not correction final conflict', () => {
  const obs = pair().map(o => o.source.target.receipt === other.receipt && o.source.kind === 'viewer-main'
    ? observe('viewer-main', html(other, [target.receipt, other.receipt], true), other) : o);
  const r = decideEvidence([plan(), plan(other)], obs, [edge], context);
  assert.equal(r.receipts.find(x => x.target.receipt === target.receipt)!.contradictions, 'none-observed-in-scope');
});
test('T21 different-time opposite facts remain a temporal conflict', () => {
  const bad = observe('viewer-main', html(target, [target.receipt], true), target, '2026-09-30T08:59:00Z');
  assert.ok(decide([...complete().slice(0, 2), bad]).reasons.includes('TEMPORAL_CONFLICT_REVIEW'));
});
test('T22 explicit skew limit is inclusive at millisecond boundary', () => {
  for (const [delta, expected] of [[899999, 'WITHIN_LIMITS'], [900000, 'WITHIN_LIMITS'], [900001, 'SKEW_EXCEEDED']] as const) {
    assert.equal(decide([changedTime('list-all', -delta), ...complete().slice(1)]).temporal.outcome, expected);
  }
});
test('T23 final observation age, not oldest metadata age, controls inclusive expiry', () => {
  for (const [delta, expected] of [[86399999, 'WITHIN_LIMITS'], [86400000, 'WITHIN_LIMITS'], [86400001, 'EXPIRED']] as const) {
    const obs = complete().map(o => observe(o.source.kind, undefined, target, new Date(Date.parse(at) - delta).toISOString()));
    assert.equal(decide(obs).temporal.outcome, expected);
  }
  assert.equal(decide([changedTime('list-all', -86400001), ...complete().slice(1)], {
    evaluatedAt: at, policy: { kind: 'simulation', maxSkewMs: 86400002, maxFinalAgeMs: 86400000 },
  }).temporal.outcome, 'WITHIN_LIMITS');
});
test('T24 future timestamp is not clamped', () => {
  assert.equal(decide().temporal.providerFinalAgeMs, 0);
  assert.ok(decide([complete()[0]!, changedTime('list-final', 1), complete()[2]!]).reasons.includes('TIME_IN_FUTURE'));
});
test('T25 missing, timezone-free, invalid calendar and leap second timestamps fail', () => {
  for (const time of [null, '2026-09-30T09:00:00', '2026-02-30T00:00:00Z', '2026-09-30T09:00:60Z', '2026-09-30T09:00:00.0001Z']) {
    const s = source('list-final', page()); s.response.bodyReceivedAt = time;
    const result = decide([complete()[0]!, extractObservation(s, Buffer.from(page())), complete()[2]!]);
    assert.equal(result.temporal.completeness, 'invalid-time');
  }
});
test('T26 request/header/body reversals are invalid', () => {
  const s = source('list-final', page()); s.response.bodyReceivedAt = '2026-09-30T08:59:59Z';
  assert.ok(decide([complete()[0]!, extractObservation(s, Buffer.from(page())), complete()[2]!]).reasons.includes('TIME_REVERSED'));
});
test('T27 offset variants denote the same instant', () => {
  assert.equal(parseInstant(at), parseInstant('2026-09-30T18:00:00+09:00'));
  assert.equal(decide(complete().map(o => observe(o.source.kind, undefined, target, '2026-09-30T18:00:00+09:00'))).temporal.skewMs, 0);
});
test('T28 approved boolean or unregistered approved policy is rejected', () => {
  for (const policy of [{ kind: 'not-approved', approved: true }, { kind: 'approved-policy-reference', policyId: 'fake' }]) {
    assert.throws(() => decide(complete(), { evaluatedAt: at, policy } as unknown as DecisionContext), /POLICY_NOT_APPROVED/);
  }
});
test('T29 unapproved and explicit simulation differ; missing defaults and approved mode are unsupported', () => {
  assert.equal(decide(complete(), { evaluatedAt: at, policy: { kind: 'not-approved' } }).temporal.outcome, 'NOT_EVALUATED');
  assert.equal(decide().temporal.policyStatus, 'POLICY_SIMULATION');
  assert.throws(() => decide(complete(), { evaluatedAt: at, policy: { kind: 'simulation' } } as unknown as DecisionContext), /SIMULATION_PARAMETERS_REQUIRED/);
});
test('T30 expiry creates no legal downgrade or DB plan', () => {
  const r = decide(complete(), { ...context, evaluatedAt: '2026-10-02T09:00:00Z' });
  assert.equal(r.temporal.outcome, 'EXPIRED'); assert.equal('legalStatus' in r, false); assert.equal('manual_hold' in r, false);
});
test('T31 old explicit true and later empty rm are retained, never a false update', () => {
  const old = observe('list-all', page([{ ...row(), rm: '정철' }]), target, '2026-09-30T08:59:00Z'); old.source.id = 'old';
  const r = decide([...complete(), old]);
  assert.ok(r.withdrawal.includes('observed')); assert.ok(r.withdrawal.includes('not-observed-in-field'));
  assert.equal(r.contradictions, 'review-required');
});
test('T32 changed source body and time produce distinct observations; identical aliases deduplicate', () => {
  const old = observe('list-final', page([{ ...row(), report_nm: 'Other report' }]), target, '2026-09-30T08:59:00Z'); old.source.id = 'old';
  assert.notEqual(old.id, complete()[1]!.id);
  assert.equal(decide([...complete(), old]).observationIds.length, 4);
  const alias = structuredClone(complete()[1]!); alias.source.id = 'alias'; alias.evidence.forEach(e => { e.artifactId = 'alias'; });
  assert.equal(decide([...complete(), alias]).observationIds.length, 3);
});
test('T33 conflicting family observations stay held; no establishment hash replacement API', () => {
  const obs = pair().map(o => o.source.target.receipt === other.receipt && o.source.kind === 'viewer-main'
    ? observe('viewer-main', html(other), other) : o);
  const r = decideEvidence([plan(), plan(other)], obs, [edge], context).relations[0]!;
  assert.ok(r.reasons.includes('FAMILY_EVIDENCE_CONFLICT')); assert.equal('verificationReferenceHash' in r, false);
});
test('T34 bytes/hash mismatch and path/symlink escape are rejected; source locations are derived', async () => {
  const s = source('list-all', page()); s.rawBodySha256 = 'a'.repeat(64);
  assert.throws(() => extractObservation(s, Buffer.from(page())), /SOURCE_HASH_MISMATCH/);
  const o = observe('list-all'); assert.deepEqual(o.evidence[1]!.locator, { kind: 'json', pointer: '/list/0' });
  const root = await mkdtemp('/private/tmp/alpha-evidence-test-');
  try {
    await writeFile(`${root}/data.json`, '{}'); await symlink(`${root}/data.json`, `${root}/link.json`);
    const catalog = { root, files: { 'data.json': sha256('{}'), 'link.json': sha256('{}'), '../data.json': sha256('{}') } };
    assert.equal((await readCatalogFile(catalog, 'data.json')).toString(), '{}');
    await assert.rejects(readCatalogFile(catalog, '../data.json'), /SOURCE_PATH_REJECTED/);
    await assert.rejects(readCatalogFile(catalog, 'link.json'), /SOURCE_PATH_REJECTED/);
    await assert.rejects(readCatalogFile(catalog, '.env'), /SOURCE_PATH_REJECTED/);
  } finally { await rm(root, { recursive: true }); }
});
test('T35 deterministic order, duplicates and no mutation; same source ID conflict rejects', () => {
  const obs = complete(), before = JSON.stringify(obs);
  assert.deepEqual(decide(obs), decide([...obs].reverse())); assert.deepEqual(decide(obs), decide([...obs, obs[0]!]));
  assert.equal(JSON.stringify(obs), before);
  const bad = structuredClone(obs[0]!) as ReceiptObservation; bad.facts.withdrawalRemark = 'observed';
  assert.throws(() => decide([...obs, bad]), /EVIDENCE_ID_CONFLICT/);
});
test('T36 evaluation imports have no network/DB/writer/clock dependency; repeated decisions are identical', async () => {
  assert.equal(FIXTURE_EVALUATED_AT, '2026-09-30T09:10:00.000Z');
  for (const file of ['contracts', 'input', 'loader', 'extract', 'decision']) {
    const text = await readFile(new URL(`../evaluation/filingDense/evidenceMapping/${file}.ts`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /from\s+['"](?:pg|openai|node:https?|node:net)|fetch\s*\(|Date\.now\s*\(|\.\.\/.*src\//);
  }
  const before = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('NETWORK_FORBIDDEN'); };
  try { assert.deepEqual(decide(), decide()); } finally { globalThis.fetch = before; }
});
