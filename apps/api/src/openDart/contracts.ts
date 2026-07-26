export type OpenDartStaleReason =
  | 'corp-code-index'
  | 'company-profile-cache'
  | 'disclosures-cache';

export interface OpenDartResponseMetadata {
  source: 'opendart-fss';
  retrievedAt: string;
  stale: boolean;
  staleReasons: OpenDartStaleReason[];
  fallback: false;
  requestId?: string;
}

export type CompanyMarket = 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'OTHER' | 'UNKNOWN';

export interface CorpCodeRecord {
  corpCode: string;
  corpName: string;
  corpEngName: string | null;
  stockCode: string;
  companyInfoModifiedDate: string;
}

export interface CorpCodeIndexSnapshot {
  schemaVersion: 1;
  refreshedAt: string;
  recordCount: number;
  checksum: string;
  records: CorpCodeRecord[];
}

export interface CorpCodeResolution {
  record: CorpCodeRecord | null;
  indexStale: boolean;
  indexRefreshedAt: string;
}

export interface CompanyProfileDto {
  symbol: string;
  corpCode: string;
  legalName: string;
  englishName: string | null;
  displayName: string;
  chiefExecutive: string | null;
  market: CompanyMarket;
  industryCode: string | null;
  establishedDate: string | null;
  fiscalYearEndMonth: string | null;
  websiteUrl: string | null;
  irUrl: string | null;
  companyInfoModifiedDate: string;
}

export interface CompanyProfileResponseDto {
  company: CompanyProfileDto;
  metadata: OpenDartResponseMetadata;
}

export interface DisclosureQueryDto {
  from: string;
  to: string;
  finalOnly: boolean;
  category: string | null;
  detailCategory: string | null;
  page: number;
  pageSize: number;
}

export type DisclosureCorrectionType =
  | 'none'
  | 'content-correction'
  | 'attachment-correction'
  | 'attachment-added'
  | 'registration-changed'
  | 'extension-decided'
  | 'issuance-terms-finalized'
  | 'correction-order'
  | 'correction-request'
  | 'unknown';

export interface DisclosureDto {
  receiptNumber: string;
  symbol: string;
  corpCode: string;
  companyName: string;
  reportName: string;
  filerName: string | null;
  receiptDate: string;
  market: CompanyMarket;
  correctionType: DisclosureCorrectionType;
  hasSubsequentCorrection: boolean;
  isWithdrawn: boolean;
  includesConsolidated: boolean;
  viewerUrl: string;
}

export interface DisclosurePageDto {
  items: DisclosureDto[];
  pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
  query: DisclosureQueryDto;
  metadata: OpenDartResponseMetadata;
}

export type OpenDartCompanyProfileRaw = Record<string, unknown>;
export interface OpenDartDisclosurePageRaw {
  status: string;
  page_no?: unknown;
  page_count?: unknown;
  total_count?: unknown;
  total_page?: unknown;
  list?: unknown;
}
