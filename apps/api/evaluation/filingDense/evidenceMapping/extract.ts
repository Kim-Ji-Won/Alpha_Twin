import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { EXTRACTION_RULE, EvidenceMappingError, requireEvidence,
  type Field, type Marker, type ReceiptObservation, type SourceArtifact } from './contracts.js';
import { fingerprint, parseJson, record, validateSource } from './input.js';
import { warningContainers } from './warningProfile.js';

function rawField(row: Record<string, unknown>, key: string): Field<string | null> {
  if (!Object.hasOwn(row, key)) return { state: 'missing' };
  const value = row[key];
  return value === null || (typeof value === 'string' && value.length <= 1000)
    ? { state: 'present', value } : { state: 'invalid' };
}
function marker(field: Field<string | null>, text: string): Marker {
  if (field.state === 'missing') return 'field-missing';
  if (field.state === 'invalid' || field.value === null) return 'field-invalid';
  return field.value.includes(text) ? 'observed' : 'not-observed-in-field';
}
function list(o: ReceiptObservation, text: string): void {
  const integer = (v: unknown): number => {
    requireEvidence((typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)
      || (typeof v === 'string' && /^(0|[1-9]\d{0,8})$/.test(v)), 'MALFORMED_RESPONSE');
    return Number(v);
  };
  const page = record(parseJson(text));
  o.evidence.push({ artifactId: o.source.id, rawBodySha256: o.source.rawBodySha256,
    extractionRuleVersion: EXTRACTION_RULE, locator: { kind: 'json', pointer: '' } });
  requireEvidence(typeof page.status === 'string' && /^\d{3}$/.test(page.status), 'MALFORMED_RESPONSE');
  requireEvidence(o.source.response.providerStatus === page.status, 'SOURCE_CONTEXT_MISMATCH');
  if (page.status === '013') {
    for (const key of ['page_no', 'page_count']) if (Object.hasOwn(page, key)) {
      requireEvidence(integer(page[key]) === Number(o.source.request.parameters[key]), 'MALFORMED_RESPONSE');
    }
    requireEvidence(page.list === undefined || (Array.isArray(page.list) && page.list.length === 0), 'MALFORMED_RESPONSE');
    for (const key of ['total_count', 'total_page']) if (page[key] !== undefined) {
      requireEvidence(integer(page[key]) === 0, 'MALFORMED_RESPONSE');
    }
    o.state = 'absent-in-this-response'; o.exactReceiptMatchCount = 0;
    o.pagination = 'complete-for-requested-day'; o.reasons.push('TARGET_ABSENT'); return;
  }
  if (page.status !== '000') { o.state = 'unavailable'; o.reasons.push('PROVIDER_ERROR'); return; }
  const number = integer(page.page_no), size = integer(page.page_count);
  const total = integer(page.total_count), pages = integer(page.total_page);
  requireEvidence(number === Number(o.source.request.parameters.page_no)
    && size === Number(o.source.request.parameters.page_count)
    && pages === Math.ceil(total / size) && number >= 1 && number <= Math.max(1, pages)
    && Array.isArray(page.list) && page.list.length <= 100
    && page.list.length === Math.max(0, Math.min(size, total - (number - 1) * size)), 'MALFORMED_RESPONSE');
  const rows = page.list.map(record);
  requireEvidence(rows.every(r => typeof r.rcept_no === 'string' && /^\d{14}$/.test(r.rcept_no)), 'MALFORMED_RESPONSE');
  const matches = rows.map((row, index) => ({ row, index })).filter(x => x.row.rcept_no === o.source.target.receipt);
  o.exactReceiptMatchCount = matches.length;
  o.pagination = pages <= 1 ? 'complete-for-requested-day' : 'incomplete';
  if (pages > 1) o.reasons.push('PAGINATION_INCOMPLETE');
  if (matches.length > 1) { o.state = 'ambiguous'; o.reasons.push('DUPLICATE_EXACT_TARGET'); return; }
  if (matches.length === 0) {
    o.state = pages > 1 ? 'incomplete' : 'absent-in-this-response';
    o.reasons.push('TARGET_ABSENT'); return;
  }
  const { row, index } = matches[0]!;
  o.evidence.push({ artifactId: o.source.id, rawBodySha256: o.source.rawBodySha256,
    extractionRuleVersion: EXTRACTION_RULE, locator: { kind: 'json', pointer: `/list/${index}` } });
  const t = o.source.target;
  if (row.corp_code !== t.corpCode || row.stock_code !== t.symbol || row.rcept_dt !== t.filingDate
    || row.corp_name !== t.companyName) {
    o.identity = 'conflicting'; o.state = 'malformed'; o.reasons.push('IDENTITY_MISMATCH'); return;
  }
  o.identity = 'exact'; o.state = pages > 1 ? 'incomplete' : 'exact';
  o.rawReportName = rawField(row, 'report_nm'); o.rawRemarks = rawField(row, 'rm');
  o.facts.contentCorrectionTitle = marker(o.rawReportName, '[기재정정]');
  o.facts.subsequentCorrectionRemark = marker(o.rawRemarks, '정');
  o.facts.withdrawalRemark = marker(o.rawRemarks, '철');
  o.facts.consolidatedPartRemark = marker(o.rawRemarks, '연');
  if (o.rawReportName.state !== 'present' || typeof o.rawReportName.value !== 'string'
    || !o.rawReportName.value.trim()) { o.state = 'malformed'; o.reasons.push('MALFORMED_RESPONSE'); }
}

const parser = new XMLParser({ ignoreAttributes: false, allowBooleanAttributes: true,
  parseTagValue: false, parseAttributeValue: false, processEntities: true, htmlEntities: true });
function fragment(xml: string, tag: string): Record<string, unknown> {
  requireEvidence(!/<!|<\?/.test(xml) && XMLValidator.validate(xml, { allowBooleanAttributes: true }) === true,
    'SOURCE_STRUCTURE_UNSUPPORTED');
  return record(record(parser.parse(xml))[tag]);
}
function textContent(html: string): string {
  requireEvidence(!/[<>]/.test(html), 'SOURCE_STRUCTURE_UNSUPPORTED');
  const value = record(parser.parse(`<text>${html}</text>`)).text;
  requireEvidence(typeof value === 'string', 'SOURCE_STRUCTURE_UNSUPPORTED');
  return value.replace(/\s+/g, ' ').trim();
}
// A deliberately narrow static profile: executable/inert blocks are masked without changing offsets.
function visibleProfile(text: string): string {
  let result = text.replace(/<!--[\s\S]*?-->/g, match => match.replace(/[^\n]/g, ' '));
  requireEvidence(!result.includes('<!--'), 'SOURCE_STRUCTURE_UNSUPPORTED');
  for (const tag of ['script', 'style', 'template', 'noscript', 'textarea']) {
    result = result.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'),
      match => match.replace(/[^\n]/g, ' '));
    requireEvidence(!new RegExp(`<\\/?${tag}\\b`, 'i').test(result), 'SOURCE_STRUCTURE_UNSUPPORTED');
  }
  requireEvidence(!/<!ENTITY|<!\[CDATA\[/i.test(result), 'SOURCE_STRUCTURE_UNSUPPORTED');
  return result;
}
function viewer(o: ReceiptObservation, text: string): void {
  const html = visibleProfile(text), t = o.source.target;
  const locate = (selector: string, index: number, length: number): void => {
    o.evidence.push({ artifactId: o.source.id, rawBodySha256: o.source.rawBodySha256,
      extractionRuleVersion: EXTRACTION_RULE, locator: { kind: 'html', selector,
        startLine: text.slice(0, index).split('\n').length, endLine: text.slice(0, index + length).split('\n').length } });
  };
  const titles = [...html.matchAll(/<title\b[^>]*>([^<]*)<\/title\s*>/gi)];
  requireEvidence(titles.length === 1, 'SOURCE_STRUCTURE_UNSUPPORTED');
  const title = textContent(titles[0]![1]!).split('/');
  requireEvidence(title.length === 3 && title[0] === t.companyName && Boolean(title[1])
    && title[2] === `${t.filingDate.slice(0, 4)}.${t.filingDate.slice(4, 6)}.${t.filingDate.slice(6)}`, 'IDENTITY_MISMATCH');
  const spans = [...html.matchAll(/<span\b([^>]*)>([^<]*)<\/span\s*>/gi)];
  const company = spans.filter(m => /openCorpInfoNew/.test(m[1]!));
  requireEvidence(company.length === 1, 'SOURCE_STRUCTURE_UNSUPPORTED');
  const companyAttrs = fragment(company[0]![0], 'span');
  const onclick = companyAttrs['@_onclick'];
  requireEvidence(typeof onclick === 'string' && new RegExp(`^openCorpInfoNew\\('${t.corpCode}',\\s*'winCorpInfo',\\s*'/dsae001/selectPopup.ax'\\);?$`).test(onclick)
    && textContent(company[0]![2]!) === t.companyName, 'IDENTITY_MISMATCH');
  const selects = [...html.matchAll(/<select\b[^>]*>[\s\S]*?<\/select\s*>/gi)];
  requireEvidence(selects.length === (html.match(/<select\b/gi) ?? []).length, 'SOURCE_STRUCTURE_UNSUPPORTED');
  const families = selects.filter(m => fragment(m[0], 'select')['@_id'] === 'family');
  requireEvidence(families.length === 1, families.length > 1 ? 'DUPLICATE_SOURCE_STRUCTURE' : 'SOURCE_STRUCTURE_UNSUPPORTED');
  const labels = [...html.matchAll(/<label\b[^>]*>[^<]*<\/label\s*>/gi)]
    .filter(m => fragment(m[0], 'label')['@_for'] === 'family');
  requireEvidence(labels.length === 1 && fragment(labels[0]![0], 'label')['#text'] === '본문', 'SOURCE_STRUCTURE_UNSUPPORTED');
  const family = families[0]!;
  const options = [...family[0].matchAll(/<option\b[^>]*>[^<]*<\/option\s*>/gi)];
  requireEvidence(options.length > 0 && options.length <= 100
    && !family[0].replace(/^<select\b[^>]*>/i, '').replace(/<\/select\s*>$/i, '')
      .replace(/<option\b[^>]*>[^<]*<\/option\s*>/gi, '').trim(), 'SOURCE_STRUCTURE_UNSUPPORTED');
  const selected: { receipt: string; title: string }[] = [];
  for (const option of options) {
    const attrs = fragment(option[0], 'option');
    if (attrs['@_value'] === 'null') { requireEvidence(attrs['@_selected'] === undefined, 'SOURCE_STRUCTURE_UNSUPPORTED'); continue; }
    const value = attrs['@_value'];
    requireEvidence(typeof value === 'string' && /^rcpNo=\d{14}$/.test(value), 'SOURCE_STRUCTURE_UNSUPPORTED');
    const receipt = value.slice(6);
    o.facts.familyMembers.push(receipt);
    if (attrs['@_selected'] !== undefined) selected.push({ receipt, title: String(attrs['@_title'] ?? '') });
    locate('select#family > option', family.index! + option.index!, option[0].length);
  }
  requireEvidence(new Set(o.facts.familyMembers).size === o.facts.familyMembers.length && selected.length === 1, 'DUPLICATE_SOURCE_STRUCTURE');
  requireEvidence(selected[0]!.receipt === t.receipt
    && selected[0]!.title.trim().length > 0
    && selected[0]!.title === title[1]!.replace(/^\[[^\]]+\]/, ''), 'IDENTITY_MISMATCH');
  const warnings = warningContainers(html);
  requireEvidence((html.match(/<iframe\b[^>]*\bid=["']ifrm["']/gi) ?? []).length === 1, 'SOURCE_STRUCTURE_UNSUPPORTED');
  o.facts.explicitNonFinalWarning = 'not-observed';
  if (warnings.length) {
    const w = warnings[0]!;
    const inner = html.slice(w.contentStart, w.end).replace(/<\/div\s*>$/i, '');
    requireEvidence(XMLValidator.validate(`<div>${inner}</div>`, { allowBooleanAttributes: true }) === true,
      'SOURCE_STRUCTURE_UNSUPPORTED');
    const contents = inner.replace(/<span\b[^>]*>/gi, '').replace(/<\/span\s*>/gi, '');
    const message = contents.trim() ? textContent(contents) : '';
    requireEvidence(message === '' || message === '본 문서는 최종문서가 아니므로 투자판단시 유의하시기 바랍니다.', 'SOURCE_STRUCTURE_UNSUPPORTED');
    if (message) o.facts.explicitNonFinalWarning = 'observed';
    locate('div.warning', w.index, w.end - w.index);
  }
  locate('title', titles[0]!.index!, titles[0]![0].length);
  locate('span[onclick:openCorpInfoNew]', company[0]!.index!, company[0]![0].length);
  locate('select#family', family.index!, family[0].length);
  o.facts.selectedReceipt = selected[0]!.receipt;
  o.rawReportName = { state: 'present', value: title[1]! };
  o.facts.familyMembers.sort(); o.identity = 'exact'; o.state = 'exact';
}

export function extractObservation(source: SourceArtifact, bytes: Uint8Array): ReceiptObservation {
  validateSource(source, bytes);
  const context = structuredClone(source);
  // File aliases are not independent observations; context, not filename/body alone, is the identity.
  const { id: _alias, ...identityContext } = context;
  const o: ReceiptObservation = { id: fingerprint({ rule: EXTRACTION_RULE, ...identityContext }), source: context,
    state: 'malformed', evidence: [], reasons: [], exactReceiptMatchCount: null, identity: 'unproven',
    rawReportName: { state: 'missing' }, rawRemarks: { state: 'missing' }, pagination: 'not-applicable',
    facts: { contentCorrectionTitle: 'field-missing', subsequentCorrectionRemark: 'field-missing',
      withdrawalRemark: 'field-missing', consolidatedPartRemark: 'field-missing', providerFinal: 'not-applicable',
      explicitNonFinalWarning: 'not-assessable', selectedReceipt: null, familyMembers: [] } };
  try {
    if (source.response.httpStatus !== 200) { o.state = 'unavailable'; o.reasons.push('HTTP_UNAVAILABLE'); }
    else {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (source.kind === 'viewer-main') viewer(o, text); else list(o, text);
    }
  } catch (error) {
    const code = error instanceof EvidenceMappingError ? error.code : 'MALFORMED_RESPONSE';
    o.state = code === 'DUPLICATE_SOURCE_STRUCTURE' ? 'ambiguous' : 'malformed';
    if (code === 'IDENTITY_MISMATCH') o.identity = 'conflicting';
    else o.identity = 'unproven';
    o.facts.explicitNonFinalWarning = 'not-assessable'; o.facts.familyMembers = [];
    o.reasons.push(code);
  }
  if (source.kind === 'list-final') o.facts.providerFinal = o.state === 'exact' ? 'positive' : o.state;
  o.reasons.sort();
  return o;
}
