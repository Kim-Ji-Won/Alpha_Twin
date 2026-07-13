import { AppConfig } from '../config.js';
import { CandleRange, StockCandleDto, StockQuoteDto } from '../contracts.js';
import { MarketDataProvider } from './marketDataProvider.js';
import { mapPublicDataCandle, mapPublicDataQuote, PublicDataStockItem } from './publicDataMapper.js';

const SUPPORTED_SYMBOLS = new Set(['000660', '005930']);
const RANGE_MONTHS: Record<CandleRange, number> = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 };
const DEFAULT_BASE_URL = 'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService';

type FetchLike = typeof fetch;
type UnknownRecord = Record<string, unknown>;

export class PublicDataProviderError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PublicDataProviderError';
  }
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function kstDate(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

function shiftMonths(dateText: string, months: number): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function addDays(dateText: string, days: number): string {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function apiDate(dateText: string): string {
  return dateText.replaceAll('-', '');
}

function responseItems(payload: unknown): PublicDataStockItem[] {
  const response = asRecord(asRecord(payload)?.response);
  const header = asRecord(response?.header);
  const resultCode = header?.resultCode;
  const normalizedResultCode = resultCode == null ? undefined : String(resultCode);
  if (normalizedResultCode != null && !['0', '00', '0000'].includes(normalizedResultCode)) {
    throw new PublicDataProviderError('UPSTREAM_REJECTED', 'Public market data request was rejected');
  }

  const body = asRecord(response?.body);
  const items = asRecord(body?.items)?.item;
  if (Array.isArray(items)) return items.map(asRecord).filter((item): item is PublicDataStockItem => item != null);
  const single = asRecord(items);
  return single ? [single] : [];
}

export class PublicDataMarketDataProvider implements MarketDataProvider {
  readonly id = 'public-data-fsc';
  readonly isFallback = false;
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
  ) {}

  async getQuote(symbol: string): Promise<StockQuoteDto> {
    this.assertSymbol(symbol);
    const end = addDays(kstDate(this.now()), 1);
    const begin = addDays(end, -45);
    const items = await this.fetchItems(symbol, begin, end);
    const latest = this.sortedExactItems(items, symbol).at(-1);
    if (!latest) throw new PublicDataProviderError('NO_DATA', 'No confirmed quote is available');
    return this.mapSafely(() => mapPublicDataQuote(latest));
  }

  async getDailyCandles(symbol: string, range: CandleRange): Promise<StockCandleDto[]> {
    this.assertSymbol(symbol);
    const end = addDays(kstDate(this.now()), 1);
    const begin = shiftMonths(kstDate(this.now()), RANGE_MONTHS[range]);
    const items = await this.fetchItems(symbol, begin, end);
    const candlesByDate = new Map<string, StockCandleDto>();
    for (const item of this.sortedExactItems(items, symbol)) {
      const candle = this.mapSafely(() => mapPublicDataCandle(item));
      candlesByDate.set(candle.date, candle);
    }
    const candles = [...candlesByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (candles.length === 0) throw new PublicDataProviderError('NO_DATA', 'No confirmed candles are available');
    return candles;
  }

  private assertSymbol(symbol: string): void {
    if (!SUPPORTED_SYMBOLS.has(symbol)) {
      throw new PublicDataProviderError('UNSUPPORTED_SYMBOL', 'Public market data is not enabled for this symbol');
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

  private async fetchItems(symbol: string, begin: string, end: string): Promise<PublicDataStockItem[]> {
    const serviceKey = this.config.marketDataApiKey;
    if (!serviceKey) {
      throw new PublicDataProviderError('NOT_CONFIGURED', 'Public market data credentials are not configured');
    }

    const baseUrl = (this.config.marketDataBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    const endpoint = baseUrl.endsWith('/getStockPriceInfo') ? baseUrl : `${baseUrl}/getStockPriceInfo`;
    const url = new URL(endpoint);
    url.searchParams.set('serviceKey', serviceKey);
    url.searchParams.set('resultType', 'json');
    url.searchParams.set('pageNo', '1');
    url.searchParams.set('numOfRows', '400');
    url.searchParams.set('likeSrtnCd', symbol);
    url.searchParams.set('beginBasDt', apiDate(begin));
    url.searchParams.set('endBasDt', apiDate(end));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.status === 429) {
        throw new PublicDataProviderError('RATE_LIMITED', 'Public market data rate limit was reached');
      }
      if (!response.ok) {
        throw new PublicDataProviderError('UPSTREAM_UNAVAILABLE', 'Public market data is temporarily unavailable');
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new PublicDataProviderError('INVALID_RESPONSE', 'Public market data returned an invalid response');
      }
      return responseItems(payload);
    } catch (error) {
      if (error instanceof PublicDataProviderError) throw error;
      if (controller.signal.aborted) {
        throw new PublicDataProviderError('TIMEOUT', 'Public market data request timed out');
      }
      throw new PublicDataProviderError('UPSTREAM_UNAVAILABLE', 'Public market data is temporarily unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}
