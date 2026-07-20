export const CACHE_TTL_MS = {
  quote: 45_000,
  candles: 15 * 60_000,
} as const;

export const CACHE_STALE_MAX_AGE_MS = {
  quote: 4 * 24 * 60 * 60_000,
  candles: 7 * 24 * 60 * 60_000,
} as const;

export interface CacheEntry<T> {
  value: T;
  createdAt: number;
  freshUntil: number;
  staleUntil: number;
}

export interface CacheStore {
  get<T>(key: string): Promise<CacheEntry<T> | undefined>;
  isFresh<T>(entry: CacheEntry<T>): boolean;
  set<T>(key: string, value: T, freshTtlMs: number, staleMaxAgeMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  clearExpired(): Promise<void>;
  readonly kind: string;
  readonly size: number;
}

export class MemoryCacheStore implements CacheStore {
  readonly kind = 'memory';
  private readonly values = new Map<string, CacheEntry<unknown>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 500,
  ) {}

  get size(): number {
    return this.values.size;
  }

  async get<T>(key: string): Promise<CacheEntry<T> | undefined> {
    const entry = this.values.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (entry.staleUntil <= this.now()) {
      this.values.delete(key);
      return undefined;
    }
    return entry;
  }

  isFresh<T>(entry: CacheEntry<T>): boolean {
    return entry.freshUntil > this.now();
  }

  async set<T>(key: string, value: T, freshTtlMs: number, staleMaxAgeMs: number): Promise<void> {
    const createdAt = this.now();
    this.values.delete(key);
    this.values.set(key, {
      value,
      createdAt,
      freshUntil: createdAt + freshTtlMs,
      staleUntil: createdAt + staleMaxAgeMs,
    });
    await this.clearExpired();
    while (this.values.size > this.maxEntries) {
      const oldestKey = this.values.keys().next().value as string | undefined;
      if (oldestKey == null) break;
      this.values.delete(oldestKey);
    }
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async clearExpired(): Promise<void> {
    const now = this.now();
    for (const [key, entry] of this.values) {
      if (entry.staleUntil <= now) this.values.delete(key);
    }
  }
}

// Compatibility name retained for P3-B/P3-C-1 call sites.
export class MemoryCache extends MemoryCacheStore {}
