import { createHash } from 'node:crypto';

import { serializeJson } from '../persistence/fingerprints.js';
import {
  ACTIVE_FILING_SCOPE_ID,
  ACTIVE_FILING_SCOPE_VERSION,
  ActiveScopeFingerprintInput,
} from './contracts.js';

export function activeFilingScopeFingerprint(input: ActiveScopeFingerprintInput): string {
  return createHash('sha256').update(serializeJson({
    scopeId: ACTIVE_FILING_SCOPE_ID,
    scopeVersion: ACTIVE_FILING_SCOPE_VERSION,
    ...input,
  })).digest('hex');
}
