import { createHash } from 'node:crypto';

export function lineageFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function familyBaseFingerprint(input: {
  readonly provider: string;
  readonly corpCode: string;
  readonly symbol: string;
  readonly rootReceiptNumber: string;
}): string {
  return lineageFingerprint({
    provider: input.provider,
    corpCode: input.corpCode,
    symbol: input.symbol,
    rootReceiptNumber: input.rootReceiptNumber,
    members: [{ receiptNumber: input.rootReceiptNumber, role: 'root' }],
    edges: [],
  });
}

export function familyGraphFingerprint(input: {
  readonly provider: string;
  readonly corpCode: string;
  readonly symbol: string;
  readonly rootReceiptNumber: string;
  readonly members: readonly {
    readonly receipt_number: string;
    readonly member_role: string;
    readonly membership_fingerprint: string;
  }[];
  readonly edges: readonly {
    readonly correction_receipt_number: string;
    readonly corrects_receipt_number: string;
    readonly relation_type: string;
    readonly relation_fingerprint: string;
  }[];
}): string {
  return lineageFingerprint({
    provider: input.provider,
    corpCode: input.corpCode,
    symbol: input.symbol,
    rootReceiptNumber: input.rootReceiptNumber,
    members: input.members,
    edges: input.edges,
  });
}

function stable(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  throw new TypeError('Unsupported lineage fingerprint value');
}
