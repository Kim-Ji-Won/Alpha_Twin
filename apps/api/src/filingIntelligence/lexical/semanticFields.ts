export interface FilingLexicalChunkSemanticFields {
  readonly sectionPath: readonly string[];
  readonly tableId?: string | null;
}

export interface FilingLexicalDocumentSemanticFields {
  readonly companyName?: string | null;
  readonly symbol: string;
  readonly corpCode?: string;
  readonly receiptNumber?: string;
  readonly reportName?: string | null;
  readonly reportCode?: string | null;
  readonly filingDate?: string;
  readonly sourceTitle?: string | null;
  readonly upstreamReportName?: string | null;
}

export function filingLexicalWeightAText(fields: FilingLexicalChunkSemanticFields): string {
  return fields.sectionPath.join(' ');
}

export function filingLexicalWeightCText(fields: FilingLexicalDocumentSemanticFields): string {
  return [fields.companyName, fields.symbol, fields.reportName, fields.reportCode, fields.filingDate]
    .filter((value): value is string => Boolean(value))
    .join(' ');
}
