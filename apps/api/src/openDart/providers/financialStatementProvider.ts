import {
  FinancialReportCode,
  FinancialStatementDivision,
  OpenDartFinancialRawResponse,
} from '../contracts.js';
import { OPENDART_MAX_JSON_BYTES, OpenDartHttpClient } from '../openDartHttpClient.js';

export const MAX_FINANCIAL_JSON_BYTES = OPENDART_MAX_JSON_BYTES;

export interface FinancialStatementProviderInput {
  corpCode: string;
  businessYear: string;
  reportCode: FinancialReportCode;
  fsDiv: FinancialStatementDivision;
}

export interface FinancialStatementProvider {
  getFinancialStatements(input: FinancialStatementProviderInput): Promise<OpenDartFinancialRawResponse>;
}

export class OpenDartFinancialStatementProvider implements FinancialStatementProvider {
  readonly id = 'opendart-fss';

  constructor(private readonly client: OpenDartHttpClient) {}

  getFinancialStatements(input: FinancialStatementProviderInput): Promise<OpenDartFinancialRawResponse> {
    return this.client.getJson<OpenDartFinancialRawResponse>(
      'financial-statements',
      '/api/fnlttSinglAcntAll.json',
      {
        corp_code: input.corpCode,
        bsns_year: input.businessYear,
        reprt_code: input.reportCode,
        fs_div: input.fsDiv,
      },
    );
  }
}
