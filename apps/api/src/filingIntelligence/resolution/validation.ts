import { FILING_PROVIDERS } from '../lineage/contracts.js';
import {
  ClearResolutionControlInput,
  RESOLUTION_REASON_CODES,
  ResolveFamilyInput,
  SetManualReceiptSelectionInput,
  SetResolutionHoldInput,
} from './contracts.js';
import { FilingResolutionError } from './errors.js';

const ID = /^[1-9]\d*$/;
const RECEIPT = /^\d{14}$/;
const CORP = /^\d{8}$/;
const SYMBOL = /^\d{6}$/;
const HASH = /^[0-9a-f]{64}$/;
const TIMESTAMP_WITH_TIMEZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function validTimestamp(value: string): boolean {
  return TIMESTAMP_WITH_TIMEZONE.test(value) && Number.isFinite(Date.parse(value));
}

export function validateResolveFamilyInput(input: ResolveFamilyInput): void {
  if (!FILING_PROVIDERS.includes(input.provider)
    || !CORP.test(input.corpCode)
    || !SYMBOL.test(input.symbol)
    || !RECEIPT.test(input.lineageRootReceiptNumber)) {
    throw new FilingResolutionError('FILING_RESOLUTION_INVALID_INPUT', false);
  }
}

function validateControlBase(
  input: ClearResolutionControlInput,
): void {
  if (!ID.test(input.familyId)
    || (input.expectedRevision != null && !ID.test(input.expectedRevision))
    || !RESOLUTION_REASON_CODES.includes(input.reasonCode)
    || !HASH.test(input.referenceHash)) {
    throw new FilingResolutionError('FILING_RESOLUTION_CONTROL_INVALID', false);
  }
  if (input.actorReferenceHash != null && !HASH.test(input.actorReferenceHash)) {
    throw new FilingResolutionError('FILING_RESOLUTION_CONTROL_REFERENCE_INVALID', false);
  }
}

export function validateHoldInput(input: SetResolutionHoldInput): void {
  validateControlBase(input);
  if (input.expiresAt != null && !validTimestamp(input.expiresAt)) {
    throw new FilingResolutionError('FILING_RESOLUTION_CONTROL_INVALID', false);
  }
}

export function validateSelectionInput(input: SetManualReceiptSelectionInput): void {
  validateControlBase(input);
  if (!ID.test(input.selectedReceiptId)
    || (input.expiresAt != null && !validTimestamp(input.expiresAt))) {
    throw new FilingResolutionError('FILING_RESOLUTION_MANUAL_SELECTION_INVALID', false);
  }
}

export function validateClearInput(input: ClearResolutionControlInput): void {
  validateControlBase(input);
}
