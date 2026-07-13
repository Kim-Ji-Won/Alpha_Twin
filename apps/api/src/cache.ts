export const CACHE_TTL_MS = {
  quote: 45_000,
  candles: 15 * 60_000,
} as const;

export const CACHE_STALE_MAX_AGE_MS = {
  quote: 4 * 24 * 60 * 60_000,
  candles: 7 * 24 * 60 * 60_000,
} as const;

interface CacheEntry<T> {
  value: T;
  createdAt: number;
  expiresAt: number;
}

export class MemoryCache {
  private readonly values = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly now: () => number = Date.now) {}

  getFresh<T>(key: string): T | undefined {
    const entry = this.values.get(key) as CacheEntry<T> | undefined;
    if (!entry || entry.expiresAt <= this.now()) return undefined;
    return entry.value;
  }

  getStale<T>(key: string, maxAgeMs = Number.POSITIVE_INFINITY): T | undefined {
    const entry = this.values.get(key) as CacheEntry<T> | undefined;
    if (!entry || this.now() - entry.createdAt > maxAgeMs) return undefined;
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    const createdAt = this.now();
    this.values.set(key, { value, createdAt, expiresAt: createdAt + ttlMs });
  }
}
