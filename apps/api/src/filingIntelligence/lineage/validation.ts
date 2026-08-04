import { DisclosureCorrectionType } from '../../openDart/contracts.js';
import {
  FILING_LEGAL_STATUSES,
  FILING_PROVIDERS,
  FilingReceiptMetadataInput,
  PersistVerifiedCorrectionRelationInput,
  PersistVerifiedReportFamilyInput,
  VERIFIED_RELATION_SOURCES,
} from './contracts.js';
import { FilingLineageError } from './errors.js';
import { lineageFingerprint } from './fingerprints.js';

const RECEIPT = /^\d{14}$/;
const CORP = /^\d{8}$/;
const SYMBOL = /^\d{6}$/;
const HASH = /^[0-9a-f]{64}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_WITH_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const CORRECTION_TYPES: readonly DisclosureCorrectionType[] = [
  'none', 'content-correction', 'attachment-correction', 'attachment-added',
  'registration-changed', 'extension-decided', 'issuance-terms-finalized',
  'correction-order', 'correction-request', 'unknown',
];

function validTimestamp(value: string): boolean {
  return TIMESTAMP_WITH_TIMEZONE.test(value) && Number.isFinite(Date.parse(value));
}

function validDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export interface PreparedReceiptMetadata {
  readonly provider: 'opendart-fss';
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
  readonly correctionType: DisclosureCorrectionType;
  readonly hasSubsequentCorrection: boolean;
  readonly isWithdrawn: boolean;
  readonly legalStatus: 'unknown' | 'reported_active' | 'withdrawn' | 'cancelled';
  readonly metadataSource: string;
  readonly metadataObservedAt: string;
  readonly providerFinalObservedAt?: string;
  readonly metadataFingerprint: string;
}

export function validateReceiptMetadata(input: FilingReceiptMetadataInput): PreparedReceiptMetadata {
  const correctionType = input.correctionType ?? 'none';
  const isWithdrawn = input.isWithdrawn ?? false;
  const legalStatus = input.legalStatus ?? (isWithdrawn ? 'withdrawn' : 'unknown');
  const metadataSource = input.metadataSource.trim();
  if (!FILING_PROVIDERS.includes(input.provider)
    || !RECEIPT.test(input.receiptNumber)
    || !CORP.test(input.corpCode)
    || !SYMBOL.test(input.symbol)
    || (input.filingDate != null && !validDateOnly(input.filingDate))
    || !CORRECTION_TYPES.includes(correctionType)
    || !FILING_LEGAL_STATUSES.includes(legalStatus)
    || (isWithdrawn && legalStatus !== 'withdrawn')
    || !metadataSource
    || !validTimestamp(input.metadataObservedAt)
    || (input.providerFinalObservedAt != null && !validTimestamp(input.providerFinalObservedAt))) {
    throw new FilingLineageError('FILING_RECEIPT_INVALID_INPUT', false);
  }
  const prepared = {
    provider: input.provider,
    receiptNumber: input.receiptNumber,
    corpCode: input.corpCode,
    symbol: input.symbol,
    companyName: optionalText(input.companyName),
    reportName: optionalText(input.reportName),
    reportCode: optionalText(input.reportCode),
    filingDate: input.filingDate,
    filerName: optionalText(input.filerName),
    disclosureCategory: optionalText(input.disclosureCategory),
    disclosureDetailType: optionalText(input.disclosureDetailType),
    correctionType,
    hasSubsequentCorrection: input.hasSubsequentCorrection ?? false,
    isWithdrawn,
    legalStatus,
    metadataSource,
    metadataObservedAt: new Date(input.metadataObservedAt).toISOString(),
    providerFinalObservedAt: input.providerFinalObservedAt == null
      ? undefined : new Date(input.providerFinalObservedAt).toISOString(),
  };
  const {
    metadataObservedAt: _,
    providerFinalObservedAt: __,
    ...fingerprinted
  } = prepared;
  return { ...prepared, metadataFingerprint: lineageFingerprint(fingerprinted) };
}

export function validateFamilyInput(input: PersistVerifiedReportFamilyInput): void {
  if (!FILING_PROVIDERS.includes(input.provider)
    || !CORP.test(input.corpCode)
    || !SYMBOL.test(input.symbol)
    || !RECEIPT.test(input.lineageRootReceiptNumber)
    || !VERIFIED_RELATION_SOURCES.includes(input.verificationSource)
    || !HASH.test(input.verificationReferenceHash)) {
    throw new FilingLineageError('FILING_FAMILY_INVALID_INPUT', false);
  }
}

export function validateRelationInput(input: PersistVerifiedCorrectionRelationInput): void {
  validateFamilyInput(input);
  if (!RECEIPT.test(input.correctionReceiptNumber)
    || !RECEIPT.test(input.correctsReceiptNumber)
    || input.relationType !== 'corrects'
    || !VERIFIED_RELATION_SOURCES.includes(input.relationSource)
    || !HASH.test(input.relationReferenceHash)
    || !validTimestamp(input.verifiedAt)) {
    throw new FilingLineageError('FILING_CORRECTION_RELATION_INVALID', false);
  }
  if (input.correctionReceiptNumber === input.correctsReceiptNumber) {
    throw new FilingLineageError('FILING_CORRECTION_SELF_REFERENCE', false);
  }
}
