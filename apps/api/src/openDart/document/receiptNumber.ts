import { OpenDartError } from '../errors.js';

export function validateReceiptNumber(input: string): string {
  if (!/^\d{14}$/.test(input)) {
    throw new OpenDartError('INVALID_RECEIPT', 'filing-document', false);
  }
  return input;
}
