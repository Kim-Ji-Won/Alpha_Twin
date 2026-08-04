import { DisclosureCorrectionType } from '../../openDart/contracts.js';

export const FILING_PROVIDERS = ['opendart-fss'] as const;
export type FilingProvider = typeof FILING_PROVIDERS[number];

export const FILING_LEGAL_STATUSES = [
  'unknown', 'reported_active', 'withdrawn', 'cancelled',
] as const;
export type FilingLegalStatus = typeof FILING_LEGAL_STATUSES[number];

export const FILING_LINEAGE_STATUSES = [
  'unresolved', 'resolved', 'conflicted', 'quarantined',
] as const;
export type FilingLineageStatus = typeof FILING_LINEAGE_STATUSES[number];

export const VERIFIED_RELATION_SOURCES = [
  'provider_authoritative', 'trusted_backfill', 'manual_verified',
] as const;
export type VerifiedRelationSource = typeof VERIFIED_RELATION_SOURCES[number];

export interface FilingReceiptMetadataInput {
  readonly provider: FilingProvider;
  readonly receiptNumber: string;
  readonly corpCode: string;
  readonly symbol: string;
  readonly companyName?: string;
  readonly reportName?: string;
  readonly reportCode?: string;
  readonly filingDate?: string;
  readonly filerName?: string;
  readonly disclosureCategory?: string;
  readonly disclosureDetailType?: string;
  readonly correctionType?: DisclosureCorrectionType;
  readonly hasSubsequentCorrection?: boolean;
  readonly isWithdrawn?: boolean;
  readonly legalStatus?: FilingLegalStatus;
  readonly metadataSource: string;
  readonly metadataObservedAt: string;
  readonly providerFinalObservedAt?: string;
}

export type ReceiptPersistenceResult = {
  readonly status: 'inserted' | 'already_present' | 'observation_updated';
  readonly receiptId: string;
  readonly metadataFingerprint: string;
};

export interface PersistVerifiedReportFamilyInput {
  readonly provider: FilingProvider;
  readonly corpCode: string;
  readonly symbol: string;
  readonly lineageRootReceiptNumber: string;
  readonly verificationSource: VerifiedRelationSource;
  readonly verificationReferenceHash: string;
}

export type ReportFamilyPersistenceResult = {
  readonly status: 'inserted' | 'already_present';
  readonly familyId: string;
  readonly revision: string;
  readonly familyFingerprint: string;
};

export interface PersistVerifiedCorrectionRelationInput
  extends PersistVerifiedReportFamilyInput {
  readonly correctionReceiptNumber: string;
  readonly correctsReceiptNumber: string;
  readonly relationType: 'corrects';
  readonly relationSource: VerifiedRelationSource;
  readonly relationReferenceHash: string;
  readonly verifiedAt: string;
}

export type CorrectionRelationPersistenceResult = {
  readonly status: 'inserted' | 'already_present';
  readonly relationId: string;
  readonly familyId: string;
  readonly familyRevision: string;
  readonly familyFingerprint: string;
};
