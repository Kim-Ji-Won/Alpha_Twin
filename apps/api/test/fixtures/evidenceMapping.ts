import type { DecisionContext, ReceiptKey, ReceiptPlan, SourceArtifact } from '../../evaluation/filingDense/evidenceMapping/contracts.js';
import { extractObservation } from '../../evaluation/filingDense/evidenceMapping/extract.js';
import { sha256 } from '../../evaluation/filingDense/evidenceMapping/input.js';

export const target: ReceiptKey = { receipt: '20260101000001', corpCode: '00000001', symbol: '000001',
  filingDate: '20260101', companyName: 'Synthetic Company' };
export const other: ReceiptKey = { ...target, receipt: '20250101000002', filingDate: '20250101' };
export const at = '2026-09-30T09:00:00.000Z';
export const context: DecisionContext = { evaluatedAt: at, policy: { kind: 'simulation', maxSkewMs: 900000, maxFinalAgeMs: 86400000 } };
export const plan = (t = target): ReceiptPlan => ({ target: t, finalQuery: 'requested' });
export function row(t = target): Record<string, unknown> {
  return { rcept_no: t.receipt, corp_code: t.corpCode, stock_code: t.symbol, rcept_dt: t.filingDate,
    corp_name: t.companyName, report_nm: 'Report (2025.12)', rm: '' };
}
export function page(rows = [row()], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ status: '000', page_no: 1, page_count: 100, total_count: rows.length, total_page: Math.ceil(rows.length / 100), list: rows, ...overrides });
}
export function html(t = target, members = [t.receipt], warning = false): string {
  return `<html><head><title>${t.companyName}/Report/${t.filingDate.slice(0, 4)}.${t.filingDate.slice(4, 6)}.${t.filingDate.slice(6)}</title></head><body>
<span onclick="openCorpInfoNew('${t.corpCode}', 'winCorpInfo', '/dsae001/selectPopup.ax');">${t.companyName}</span>
<label for="family">본문</label><select id="family"><option value="null">select</option>
${members.map(m => `<option value="rcpNo=${m}" ${m === t.receipt ? 'selected' : ''} title="Report">Report</option>`).join('\n')}</select>
<select id="att"><option value="rcpNo=19990101000000">Attachment</option></select>
<div class="warning">${warning ? '<span>본 문서는 최종문서가 아니므로 투자판단시 유의하시기 바랍니다.</span>' : ''}</div>
<iframe id="ifrm"></iframe></body></html>`;
}
export function source(kind: SourceArtifact['kind'], text: string, t = target, time = at): SourceArtifact {
  return { id: `${kind}-${t.receipt}`, kind, target: t, rawBodySha256: sha256(text),
    request: { endpoint: kind === 'viewer-main' ? 'https://dart.fss.or.kr/dsaf001/main.do' : 'https://opendart.fss.or.kr/api/list.json',
      parameters: kind === 'viewer-main' ? { rcpNo: t.receipt } : { corp_code: t.corpCode, bgn_de: t.filingDate,
        end_de: t.filingDate, last_reprt_at: kind === 'list-all' ? 'N' : 'Y', page_no: '1', page_count: '100', sort: 'date', sort_mth: 'desc' },
      provenance: 'recorded', startedAt: time },
    response: { headersObservedAt: time, bodyReceivedAt: time, httpStatus: 200, providerStatus: kind === 'viewer-main' ? null : JSON.parse(text).status } };
}
export function observe(kind: SourceArtifact['kind'], text = kind === 'viewer-main' ? html() : page(), t = target, time = at) {
  return extractObservation(source(kind, text, t, time), Buffer.from(text));
}
export function complete(t = target, members = [t.receipt]) {
  return [observe('list-all', page([row(t)]), t), observe('list-final', page([row(t)]), t), observe('viewer-main', html(t, members), t)];
}
