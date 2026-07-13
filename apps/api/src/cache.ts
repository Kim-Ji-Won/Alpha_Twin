export const CACHE_TTL_MS = {
  quote: 45_000,
  candles: 15 * 60_000,
} as const;

interface CacheEntry<T> {
  value: T;
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

  getStale<T>(key: string): T | undefined {
    return (this.values.get(key) as CacheEntry<T> | undefined)?.value;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.values.set(key, { value, expiresAt: this.now() + ttlMs });
  }
}
