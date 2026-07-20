export type MarketDataEventType =
  | 'provider_success'
  | 'provider_failure'
  | 'cache_fresh_hit'
  | 'cache_stale_hit'
  | 'mock_fallback'
  | 'symbol_not_found'
  | 'inflight_dedup_hit';

export interface MarketDataEvent {
  type: MarketDataEventType;
  provider: string;
  symbol: string;
  range?: string;
  durationMs?: number;
  pageCount?: number;
  category?: string;
}

export interface SafeLogger {
  info(data: object, message: string): void;
  warn(data: object, message: string): void;
}

export class MarketDataObservability {
  private logger?: SafeLogger;
  private readonly counts = new Map<MarketDataEventType, number>();
  private lastEvent?: MarketDataEvent;

  setLogger(logger: SafeLogger): void {
    this.logger = logger;
  }

  record(event: MarketDataEvent): void {
    this.counts.set(event.type, (this.counts.get(event.type) ?? 0) + 1);
    this.lastEvent = { ...event };
    const payload = { marketData: event };
    if (event.type === 'provider_failure' || event.type === 'symbol_not_found') {
      this.logger?.warn(payload, 'market data event');
    } else {
      this.logger?.info(payload, 'market data event');
    }
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }

  latest(): MarketDataEvent | undefined {
    return this.lastEvent ? { ...this.lastEvent } : undefined;
  }
}
