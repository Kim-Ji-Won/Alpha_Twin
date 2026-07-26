import { OpenDartStaleReason } from './contracts.js';

export interface OpenDartLogEvent {
  operation: string;
  provider: 'opendart';
  symbol?: string;
  corpCodeResolved?: boolean;
  cacheStatus?: 'fresh' | 'stale' | 'miss';
  stale?: boolean;
  staleReasons?: OpenDartStaleReason[];
  providerStatus?: string;
  durationMs?: number;
  page?: number;
  pageSize?: number;
  itemCount?: number;
  totalCount?: number;
  businessYear?: string;
  reportCode?: string;
  periodKind?: string;
  detailType?: string;
  receiptDate?: string;
  indexRecordCount?: number;
  indexRefreshedAt?: string;
  retryable?: boolean;
  requestId?: string;
  outcome: 'success' | 'empty' | 'failure';
}

export interface OpenDartSafeLogger {
  info(data: object, message: string): void;
  warn(data: object, message: string): void;
  error(data: object, message: string): void;
}

export class OpenDartObservability {
  private logger?: OpenDartSafeLogger;
  private readonly counts = new Map<string, number>();

  setLogger(logger: OpenDartSafeLogger): void {
    this.logger = logger;
  }

  record(event: OpenDartLogEvent): void {
    const key = `${event.operation}:${event.outcome}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    const payload = { openDart: event };
    if (event.outcome === 'failure') this.logger?.error(payload, 'OpenDART event');
    else if (event.stale) this.logger?.warn(payload, 'OpenDART event');
    else this.logger?.info(payload, 'OpenDART event');
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}
