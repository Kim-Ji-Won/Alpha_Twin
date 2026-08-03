import { IngestionError } from './errors.js';
import { VerifiedIngestionJobInput } from './contracts.js';

const RECEIPT = /^\d{14}$/;
const CORP = /^\d{8}$/;
const SYMBOL = /^\d{6}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function invalid(): never {
  throw new IngestionError('INGESTION_JOB_INVALID_INPUT', false);
}

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month! - 1
    && date.getUTCDate() === day;
}

export function validateVerifiedIngestionJob(
  input: VerifiedIngestionJobInput,
): VerifiedIngestionJobInput & { readonly priority: number; readonly maxAttempts: number } {
  const priority = input.priority ?? 0;
  const maxAttempts = input.maxAttempts ?? 5;
  if (
    input.provider !== 'opendart-fss'
    || !RECEIPT.test(input.receiptNumber)
    || !CORP.test(input.corpCode)
    || !SYMBOL.test(input.symbol)
    || !NAME.test(input.canonicalSchemaName)
    || !VERSION.test(input.canonicalSchemaVersion)
    || !VERSION.test(input.parserVersion)
    || !VERSION.test(input.chunkSchemaVersion)
    || !VERSION.test(input.chunkerVersion)
    || !Number.isInteger(priority) || priority < -100 || priority > 100
    || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20
    || (input.filingDate != null && !validDate(input.filingDate))
    || (input.availableAt != null && !Number.isFinite(input.availableAt.getTime()))
  ) invalid();
  return { ...input, priority, maxAttempts };
}
