export interface DisclosureArchivePolicy {
  readonly maximumCompressedBytes: number;
  readonly maximumTotalUncompressedBytes: number;
  readonly maximumEntryUncompressedBytes: number;
  readonly maximumEntries: number;
  readonly maximumFileNameBytes: number;
}

const MEBIBYTE = 1024 * 1024;

export const DEFAULT_DISCLOSURE_ARCHIVE_POLICY: DisclosureArchivePolicy = Object.freeze({
  maximumCompressedBytes: 20 * MEBIBYTE,
  maximumTotalUncompressedBytes: 64 * MEBIBYTE,
  maximumEntryUncompressedBytes: 32 * MEBIBYTE,
  maximumEntries: 64,
  maximumFileNameBytes: 255,
});

export function validateDisclosureArchivePolicy(
  policy: DisclosureArchivePolicy,
): DisclosureArchivePolicy {
  const values = Object.values(policy);
  if (values.some(value => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error('Disclosure archive limits must be positive safe integers');
  }
  if (policy.maximumEntryUncompressedBytes > policy.maximumTotalUncompressedBytes) {
    throw new Error('Single entry limit cannot exceed total uncompressed limit');
  }
  return policy;
}
