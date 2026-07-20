import { AppConfig } from '../config.js';
import { CandleRange, StockCandleDto, StockQuoteDto } from '../contracts.js';
import { MarketDataError } from '../marketDataErrors.js';
import { addCalendarDays, calculateEodQueryRange, classifyEodFreshness, getKstDateString } from '../marketDate.js';
import { MarketDataObservability } from '../observability.js';
import { MarketDataProvider } from './marketDataProvider.js';
import { mapPublicDataCandle, mapPublicDataQuote, PublicDataStockItem } from './publicDataMapper.js';

const SYMBOL_PATTERN = /^\d{6}$/;
const RANGE_MONTHS: Record<CandleRange, number> = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 };
const DEFAULT_BASE_URL = 'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService';
export const PUBLIC_DATA_PAGE_SIZE = 100;
export const PUBLIC_DATA_MAX_PAGES = 20;
export const PUBLIC_DATA_MAX_ROWS = 2_000;

type FetchLike = typeof fetch;
type UnknownRecord = Record<string, unknown>;

interface PublicDataPage {
  items: PublicDataStockItem[];
  pageNo: number;
  numOfRows: number;
  totalCount: number;
}

interface PageCollection {
  items: PublicDataStockItem[];
  pageCount: number;
}

export class PublicDataProviderError extends MarketDataError {}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function paginationInteger(value: unknown, field: string, allowZero = false): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new PublicDataProviderError('INVALID_RESPONSE', `Public market data returned invalid ${field}`);
  }
  return parsed;
}

export function normalizePublicDataPage(payload: unknown): PublicDataPage {
  const response = asRecord(asRecord(payload)?.response);
  const header = asRecord(response?.header);
  const resultCode = header?.resultCode;
  const normalizedResultCode = resultCode == null ? undefined : String(resultCode);
  if (normalizedResultCode != null && !['0', '00', '0000'].includes(normalizedResultCode)) {
    throw new PublicDataProviderError('UPSTREAM_REJECTED', 'Public market data request was rejected');
  }

  const body = asRecord(response?.body);
  if (!body) throw new PublicDataProviderError('INVALID_RESPONSE', 'Public market data returned an invalid response');
  const rawItems = asRecord(body.items)?.item;
  const arrayItems = Array.isArray(rawItems)
    ? rawItems.map(asRecord).filter((item): item is PublicDataStockItem => item != null)
    : [];
  const single = asRecord(rawItems);
  return {
    items: single ? [single] : arrayItems,
    pageNo: paginationInteger(body.pageNo, 'pageNo'),
    numOfRows: paginationInteger(body.numOfRows, 'numOfRows'),
    totalCount: paginationInteger(body.totalCount, 'totalCount', true),
  };
}

function apiDate(dateText: string): string {
  return dateText.replaceAll('-', '');
}

function pageSignature(items: PublicDataStockItem[]): string {
  return items.map(item => `${String(item.srtnCd ?? '')}:${String(item.basDt ?? '')}:${String(item.clpr ?? '')}`).join('|');
}

export class PublicDataMarketDataProvider implements MarketDataProvider {
  readonly id = 'public-data-fsc';
  readonly isFallback = false;
  readonly dataMode = 'eod' as const;
  readonly priceAdjustment = 'unknown' as const;
  readonly cachePolicy = {
    quoteTtlMs: 6 * 60 * 60_000,
    candlesTtlMs: 24 * 60 * 60_000,
    quoteStaleMaxAgeMs: 4 * 24 * 60 * 60_000,
    candlesStaleMaxAgeMs: 7 * 24 * 60 * 60_000,
  } as const;

  constructor(
    private readonly config: Pick<AppConfig, 'marketDataBaseUrl' | 'marketDataApiKey' | 'timeoutMs'>,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
    private readonly observability = new MarketDataObservability(),
  ) {}

  async getQuote(symbol: string): Promise<StockQuoteDto> {
    this.assertSymbol(symbol);
    const startedAt = Date.now();
    const end = addCalendarDays(getKstDateString(this.now()), 1);
    let pageCount = 0;
    try {
      const primary = await this.fetchAllPages(symbol, addCalendarDays(end, -45), end);
      pageCount += primary.pageCount;
      let latest = this.sortedExactItems(primary.items, symbol).at(-1);
      if (!latest) {
        const expanded = await this.fetchAllPages(symbol, addCalendarDays(end, -180), end);
        pageCount += expanded.pageCount;
        latest = this.sortedExactItems(expanded.items, symbol).at(-1);
      }
      if (!latest) throw new PublicDataProviderError('SYMBOL_NOT_FOUND', 'Stock symbol was not found');
      const quote = this.mapSafely(() => mapPublicDataQuote(latest));
      this.observability.record({
        type: 'provider_success', provider: this.id, symbol,
        durationMs: Date.now() - startedAt, pageCount,
        category: `eod_${classifyEodFreshness(quote.asOf, this.now())}`,
      });
      return quote;
    } catch (error) {
      this.recordFailure(error, symbol, undefined, startedAt, pageCount);
      throw error;
    }
  }

  async getDailyCandles(symbol: string, range: CandleRange): Promise<StockCandleDto[]> {
    this.assertSymbol(symbol);
    const startedAt = Date.now();
    let pageCount = 0;
    try {
      const query = calculateEodQueryRange(this.now(), RANGE_MONTHS[range]);
      let result = await this.fetchAllPages(symbol, query.begin, query.end);
      pageCount += result.pageCount;
      let exactItems = this.sortedExactItems(result.items, symbol);
      if (exactItems.length === 0) {
        result = await this.fetchAllPages(symbol, addCalendarDays(query.begin, -14), query.end);
        pageCount += result.pageCount;
        exactItems = this.sortedExactItems(result.items, symbol);
      }
      const candlesByDate = new Map<string, StockCandleDto>();
      for (const item of exactItems) {
        const candle = this.mapSafely(() => mapPublicDataCandle(item));
        candlesByDate.set(candle.date, candle);
      }
      const candles = [...candlesByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      if (candles.length === 0) throw new PublicDataProviderError('SYMBOL_NOT_FOUND', 'Stock symbol was not found');
      this.observability.record({
        type: 'provider_success', provider: this.id, symbol, range,
        durationMs: Date.now() - startedAt, pageCount,
        category: `eod_${classifyEodFreshness(candles.at(-1)?.date ?? '', this.now())}`,
      });
      return candles;
    } catch (error) {
      this.recordFailure(error, symbol, range, startedAt, pageCount);
      throw error;
    }
  }

  private assertSymbol(symbol: string): void {
    if (!SYMBOL_PATTERN.test(symbol)) {
      throw new PublicDataProviderError('INVALID_SYMBOL', 'Stock symbol must contain exactly six digits');
    }
  }

  private sortedExactItems(items: PublicDataStockItem[], symbol: string): PublicDataStockItem[] {
    return items
      .filter(item => item.srtnCd === symbol)
      .sort((a, b) => String(a.basDt ?? '').localeCompare(String(b.basDt ?? '')));
  }

  private mapSafely<T>(map: () => T): T {
    try {
      return map();
    } catch {
      throw new PublicDataProviderError('INVALID_RESPONSE', 'Public market data could not be normalized');
    }
  }

  private async fetchAllPages(symbol: string, begin: string, end: string): Promise<PageCollection> {
    const collected: PublicDataStockItem[] = [];
    const signatures = new Set<string>();
    let expectedTotal: number | undefined;
    let requestedPage = 1;

    while (requestedPage <= PUBLIC_DATA_MAX_PAGES) {
      const page = await this.fetchPage(symbol, begin, end, requestedPage);
      if (page.pageNo !== requestedPage) {
        throw new PublicDataProviderError('INVALID_RESPONSE', 'Public market data pagination did not advance');
      }
      if (expectedTotal == null) expectedTotal = page.totalCount;
      if (page.totalCount !== expectedTotal) {
        throw new PublicDataProviderError('INVALID_RESPONSE', 'Public market data pagination metadata changed');
      }
      const signature = pageSignature(page.items);
      if (page.items.length > 0 && signatures.has(signature)) {
        throw new PublicDataProviderError('INVALID_RESPONSE', 'Public market data repeated a page');
      }
      if (page.items.length > 0) signatures.add(signature);
      if (collected.length + page.items.length > PUBLIC_DATA_MAX_ROWS) {
        throw new PublicDataProviderError('PAGINATION_LIMIT', 'Public market data row limit was exceeded');
      }
      collected.push(...page.items);
      if (collected.length >= expectedTotal) return { items: collected, pageCount: requestedPage };
      if (page.items.length === 0) {
        throw new PublicDataProviderError('INVALID_RESPONSE', 'Public market data returned an incomplete page');
      }
      requestedPage += 1;
    }
    throw new PublicDataProviderError('PAGINATION_LIMIT', 'Public market data page limit was exceeded');
  }

  private async fetchPage(symbol: string, begin: string, end: string, pageNo: number): Promise<PublicDataPage> {
    const serviceKey = this.config.marketDataApiKey;
    if (!serviceKey) {
      throw new PublicDataProviderError('NOT_CONFIGURED', 'Public market data credentials are not configured');
    }
    const baseUrl = (this.config.marketDataBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    const endpoint = baseUrl.endsWith('/getStockPriceInfo') ? baseUrl : `${baseUrl}/getStockPriceInfo`;
    const url = new URL(endpoint);
    url.searchParams.set('serviceKey', serviceKey);
    url.searchParams.set('resultType', 'json');
    url.searchParams.set('pageNo', String(pageNo));
    url.searchParams.set('numOfRows', String(PUBLIC_DATA_PAGE_SIZE));
    url.searchParams.set('likeSrtnCd', symbol);
    url.searchParams.set('beginBasDt', apiDate(begin));
    url.searchParams.set('endBasDt', apiDate(end));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (response.status === 429) throw new PublicDataProviderError('RATE_LIMITED', 'Public market data rate limit was reached');
      if (!response.ok) throw new PublicDataProviderError('UPSTREAM_UNAVAILABLE', 'Public market data is temporarily unavailable');
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new PublicDataProviderError('INVALID_RESPONSE', 'Public market data returned an invalid response');
      }
      return normalizePublicDataPage(payload);
    } catch (error) {
      if (error instanceof MarketDataError) throw error;
      if (controller.signal.aborted) throw new PublicDataProviderError('TIMEOUT', 'Public market data request timed out');
      throw new PublicDataProviderError('UPSTREAM_UNAVAILABLE', 'Public market data is temporarily unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  private recordFailure(
    error: unknown,
    symbol: string,
    range: CandleRange | undefined,
    startedAt: number,
    pageCount: number,
  ): void {
    const category = error instanceof MarketDataError ? error.code : 'UNKNOWN';
    this.observability.record({
      type: 'provider_failure',
      provider: this.id, symbol, range, durationMs: Date.now() - startedAt, pageCount, category,
    });
  }
}
