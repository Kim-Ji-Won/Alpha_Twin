import {
  DisclosureCorrectionType,
  FinancialPeriodKind,
  FinancialReportCode,
  FinancialStatementDivision,
  FinancialStatementsResponseDto,
  OpenDartResponseMetadata,
} from '../contracts.js';
import { NormalizedFinancialSummaryDto } from '../normalization/normalizationContracts.js';

export type LatestFinancialDisclosureDetailType = 'A001' | 'A002' | 'A003';

export interface LatestFinancialReportCandidate {
  detailType: LatestFinancialDisclosureDetailType;
  receiptNumber: string;
  receiptDate: string;
  reportName: string;
  correctionType: DisclosureCorrectionType;
  hasSubsequentCorrection: boolean;
  isWithdrawn: boolean;
  corpCode: string;
}

export interface LatestFinancialReportResolutionDto {
  symbol: string;
  corpCode: string;
  businessYear: string;
  reportCode: FinancialReportCode;
  periodKind: FinancialPeriodKind;
  disclosureDetailType: LatestFinancialDisclosureDetailType;
  periodEnd: string;
  fiscalYearEndMonth: number;
  filing: {
    receiptNumber: string;
    receiptDate: string;
    reportName: string;
    correctionType: DisclosureCorrectionType;
  };
  resolutionMethod: 'opendart-final-periodic-disclosure';
  metadata: OpenDartResponseMetadata;
}

export interface LatestFinancialQuery {
  fsDiv: FinancialStatementDivision;
}

export interface LatestFinancialStatementsResponseDto {
  resolution: LatestFinancialReportResolutionDto;
  financials: FinancialStatementsResponseDto;
}

export interface LatestNormalizedFinancialSummaryResponseDto {
  resolution: LatestFinancialReportResolutionDto;
  summary: NormalizedFinancialSummaryDto;
}
