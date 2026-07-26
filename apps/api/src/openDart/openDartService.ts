import { CacheStore, MemoryCacheStore } from '../cache.js';
import {
  CompanyProfileResponseDto,
  DisclosurePageDto,
  DisclosureQueryDto,
  OpenDartResponseMetadata,
  OpenDartStaleReason,
} from './contracts.js';
import { CorpCodeResolver } from './corpCode/corpCodeResolver.js';
import { isOpenDartError, OpenDartError } from './errors.js';
import { mapCompanyProfile } from './mappers/companyProfileMapper.js';
import { mapDisclosurePage } from './mappers/disclosureMapper.js';
import { OpenDartObservability, OpenDartSafeLogger } from './observability.js';
import { CompanyDisclosureProvider } from './providers/openDartProvider.js';

export const OPENDART_CACHE_POLICY = {
  profileFreshMs: 7 * 24 * 60 * 60_000,
  profileStaleMs: 30 * 24 * 60 * 60_000,
  disclosuresFreshMs: 30 * 60_000,
  disclosuresStaleMs: 24 * 60 * 60_000,
} as const;

interface ProfileCacheValue {
  company: CompanyProfileResponseDto['company'];
  retrievedAt: string;
}

interface DisclosureCacheValue {
  page: Omit<DisclosurePageDto, 'metadata'>;
  retrievedAt: string;
}

function normalizeSymbol(input: string, operation: 'company-profile' | 'disclosures'): string {
  const symbol = input.trim();
  if (!/^\d{6}$/.test(symbol)) throw new OpenDartError('INVALID_SYMBOL', operation, false);
  return symbol;
}

function metadata(
  retrievedAt: string,
  reasons: OpenDartStaleReason[],
  requestId?: string,
): OpenDartResponseMetadata {
  const order: OpenDartStaleReason[] = ['corp-code-index', 'company-profile-cache', 'disclosures-cache'];
  const staleReasons = order.filter(reason => reasons.includes(reason));
  return {
    source: 'opendart-fss', retrievedAt, stale: staleReasons.length > 0,
    staleReasons, fallback: false, ...(requestId ? { requestId } : {}),
  };
}

export class OpenDartService {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly resolver: CorpCodeResolver,
    private readonly provider: CompanyDisclosureProvider,
    private readonly cache: CacheStore = new MemoryCacheStore(),
    private readonly now: () => Date = () => new Date(),
    private readonly observability = new OpenDartObservability(),
  ) {}

  get status() {
    return { provider: 'opendart-fss', cache: this.cache.kind, cacheEntries: this.cache.size, events: this.observability.snapshot() };
  }

  setLogger(logger: OpenDartSafeLogger): void {
    this.observability.setLogger(logger);
  }

  async getCompanyProfile(input: string, requestId?: string): Promise<CompanyProfileResponseDto> {
    const symbol = normalizeSymbol(input, 'company-profile');
    const resolution = await this.resolver.resolveByStockCode(symbol);
    if (!resolution.record) throw new OpenDartError('CORP_CODE_NOT_FOUND', 'company-profile', false);
    const key = `opendart:profile:${resolution.record.corpCode}`;
    const reasons: OpenDartStaleReason[] = resolution.indexStale ? ['corp-code-index'] : [];
    const cached = await this.cache.get<ProfileCacheValue>(key);
    if (cached && this.cache.isFresh(cached)) {
      this.record('company-profile', symbol, 'fresh', reasons, requestId, 'success');
      return { company: cached.value.company, metadata: metadata(cached.value.retrievedAt, reasons, requestId) };
    }
    const loaded = await this.singleFlight(key, async (): Promise<{ value: ProfileCacheValue; cacheStale: boolean }> => {
      const current = await this.cache.get<ProfileCacheValue>(key);
      if (current && this.cache.isFresh(current)) {
        return { value: current.value, cacheStale: false };
      }
      try {
        const raw = await this.provider.getCompanyProfile(resolution.record!.corpCode);
        const value: ProfileCacheValue = {
          company: mapCompanyProfile(symbol, resolution.record!, raw),
          retrievedAt: this.now().toISOString(),
        };
        await this.cache.set(key, value, OPENDART_CACHE_POLICY.profileFreshMs, OPENDART_CACHE_POLICY.profileStaleMs);
        this.record('company-profile', symbol, 'miss', reasons, requestId, 'success');
        return { value, cacheStale: false };
      } catch (error) {
        if (isOpenDartError(error) && error.code === 'COMPANY_PROFILE_NOT_FOUND') throw error;
        const stale = await this.cache.get<ProfileCacheValue>(key);
        if (stale) {
          const staleReasons: OpenDartStaleReason[] = [...reasons, 'company-profile-cache'];
          this.record('company-profile', symbol, 'stale', staleReasons, requestId, 'success');
          return { value: stale.value, cacheStale: true };
        }
        this.recordFailure('company-profile', symbol, requestId, error);
        throw error;
      }
    });
    const responseReasons: OpenDartStaleReason[] = loaded.cacheStale
      ? [...reasons, 'company-profile-cache']
      : reasons;
    return {
      company: loaded.value.company,
      metadata: metadata(loaded.value.retrievedAt, responseReasons, requestId),
    };
  }

  async getDisclosures(input: string, query: DisclosureQueryDto, requestId?: string): Promise<DisclosurePageDto> {
    const symbol = normalizeSymbol(input, 'disclosures');
    const resolution = await this.resolver.resolveByStockCode(symbol);
    if (!resolution.record) throw new OpenDartError('CORP_CODE_NOT_FOUND', 'disclosures', false);
    const record = resolution.record;
    const key = ['opendart', 'disclosures', record.corpCode, query.from, query.to,
      query.finalOnly ? 'Y' : 'N', query.category ?? '-', query.detailCategory ?? '-', query.page, query.pageSize].join(':');
    const reasons: OpenDartStaleReason[] = resolution.indexStale ? ['corp-code-index'] : [];
    const cached = await this.cache.get<DisclosureCacheValue>(key);
    if (cached && this.cache.isFresh(cached)) {
      this.record('disclosures', symbol, 'fresh', reasons, requestId, cached.value.page.items.length ? 'success' : 'empty');
      return { ...cached.value.page, metadata: metadata(cached.value.retrievedAt, reasons, requestId) };
    }
    const loaded = await this.singleFlight(key, async (): Promise<{ value: DisclosureCacheValue; cacheStale: boolean }> => {
      const current = await this.cache.get<DisclosureCacheValue>(key);
      if (current && this.cache.isFresh(current)) {
        return { value: current.value, cacheStale: false };
      }
      try {
        const raw = await this.provider.getDisclosures(record.corpCode, query);
        const value: DisclosureCacheValue = {
          page: mapDisclosurePage(symbol, record.corpCode, query, raw),
          retrievedAt: this.now().toISOString(),
        };
        await this.cache.set(key, value, OPENDART_CACHE_POLICY.disclosuresFreshMs, OPENDART_CACHE_POLICY.disclosuresStaleMs);
        this.record('disclosures', symbol, 'miss', reasons, requestId, value.page.items.length ? 'success' : 'empty');
        return { value, cacheStale: false };
      } catch (error) {
        const stale = await this.cache.get<DisclosureCacheValue>(key);
        if (stale) {
          const staleReasons: OpenDartStaleReason[] = [...reasons, 'disclosures-cache'];
          this.record('disclosures', symbol, 'stale', staleReasons, requestId, stale.value.page.items.length ? 'success' : 'empty');
          return { value: stale.value, cacheStale: true };
        }
        this.recordFailure('disclosures', symbol, requestId, error);
        throw error;
      }
    });
    const responseReasons: OpenDartStaleReason[] = loaded.cacheStale
      ? [...reasons, 'disclosures-cache']
      : reasons;
    return {
      ...loaded.value.page,
      metadata: metadata(loaded.value.retrievedAt, responseReasons, requestId),
    };
  }

  private singleFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const request = load().finally(() => {
      if (this.inFlight.get(key) === request) this.inFlight.delete(key);
    });
    this.inFlight.set(key, request);
    return request;
  }

  private record(
    operation: string,
    symbol: string,
    cacheStatus: 'fresh' | 'stale' | 'miss',
    staleReasons: OpenDartStaleReason[],
    requestId: string | undefined,
    outcome: 'success' | 'empty',
  ): void {
    this.observability.record({
      operation, provider: 'opendart', symbol, corpCodeResolved: true, cacheStatus,
      stale: staleReasons.length > 0, staleReasons, requestId, outcome,
    });
  }

  private recordFailure(operation: string, symbol: string, requestId: string | undefined, error: unknown): void {
    this.observability.record({
      operation, provider: 'opendart', symbol, corpCodeResolved: true, requestId, outcome: 'failure',
      retryable: isOpenDartError(error) ? error.retryable : true,
      providerStatus: isOpenDartError(error) ? error.providerStatus : undefined,
    });
  }
}
