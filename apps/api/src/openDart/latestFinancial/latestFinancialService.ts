import { FinancialStatementDivision } from '../contracts.js';
import { OpenDartError } from '../errors.js';
import { FinancialAccountNormalizer } from '../normalization/accountNormalizer.js';
import { OpenDartSafeLogger } from '../observability.js';
import { OpenDartFinancialService } from '../openDartFinancialService.js';
import {
  LatestFinancialStatementsResponseDto,
  LatestNormalizedFinancialSummaryResponseDto,
} from './latestFinancialContracts.js';
import { LatestFinancialReportResolver } from './latestFinancialReportResolver.js';

export class LatestFinancialService {
  constructor(
    private readonly resolver: LatestFinancialReportResolver,
    private readonly financials: OpenDartFinancialService,
    private readonly normalizer: FinancialAccountNormalizer,
  ) {}

  get status() {
    return this.resolver.status;
  }

  setLogger(logger: OpenDartSafeLogger): void {
    this.resolver.setLogger(logger);
  }

  async getLatestFinancials(
    symbol: string,
    fsDiv: FinancialStatementDivision,
    requestId?: string,
  ): Promise<LatestFinancialStatementsResponseDto> {
    const resolution = await this.resolver.resolve(symbol, requestId);
    const financials = await this.financials.getFinancialStatements(
      symbol,
      {
        businessYear: resolution.businessYear,
        reportCode: resolution.reportCode,
        fsDiv,
      },
      requestId,
    );
    if (resolution.filing.receiptNumber !== financials.report.receiptNumber) {
      throw new OpenDartError(
        'LATEST_FINANCIAL_REPORT_RECEIPT_MISMATCH',
        'latest-financial-report',
        false,
      );
    }
    return { resolution, financials };
  }

  async getLatestNormalizedFinancials(
    symbol: string,
    fsDiv: FinancialStatementDivision,
    requestId?: string,
  ): Promise<LatestNormalizedFinancialSummaryResponseDto> {
    const loaded = await this.getLatestFinancials(symbol, fsDiv, requestId);
    return {
      resolution: loaded.resolution,
      summary: this.normalizer.normalize(loaded.financials),
    };
  }
}
