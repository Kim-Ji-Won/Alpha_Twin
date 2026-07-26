import { CorpCodeIndexSnapshot, CorpCodeResolution } from '../contracts.js';
import { OpenDartError } from '../errors.js';
import { OpenDartObservability } from '../observability.js';
import { CorpCodeArchiveParser } from './corpCodeArchiveParser.js';
import { CorpCodeArchiveSource } from './corpCodeArchiveSource.js';
import { CorpCodeIndexStore, createCorpCodeSnapshot } from './corpCodeIndexStore.js';

export const CORP_CODE_FRESH_TTL_MS = 24 * 60 * 60_000;
export const CORP_CODE_STALE_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

export class CorpCodeResolver {
  private snapshot?: CorpCodeIndexSnapshot;
  private index = new Map<string, CorpCodeIndexSnapshot['records'][number]>();
  private refreshInFlight?: Promise<CorpCodeIndexSnapshot>;

  constructor(
    private readonly source: CorpCodeArchiveSource,
    private readonly parser: CorpCodeArchiveParser,
    private readonly store: CorpCodeIndexStore,
    private readonly now: () => Date = () => new Date(),
    private readonly observability = new OpenDartObservability(),
  ) {}

  async resolveByStockCode(input: string): Promise<CorpCodeResolution> {
    const symbol = input.trim();
    if (!/^\d{6}$/.test(symbol)) throw new OpenDartError('INVALID_SYMBOL', 'corp-code', false);
    const snapshot = await this.availableSnapshot();
    return {
      record: this.index.get(symbol) ?? null,
      indexStale: this.age(snapshot) > CORP_CODE_FRESH_TTL_MS,
      indexRefreshedAt: snapshot.refreshedAt,
    };
  }

  async refresh(_options?: { force?: boolean }): Promise<{ recordCount: number; refreshedAt: string }> {
    const snapshot = await this.refreshSnapshot();
    return { recordCount: snapshot.recordCount, refreshedAt: snapshot.refreshedAt };
  }

  private age(snapshot: CorpCodeIndexSnapshot): number {
    return this.now().getTime() - Date.parse(snapshot.refreshedAt);
  }

  private setSnapshot(snapshot: CorpCodeIndexSnapshot): void {
    this.snapshot = snapshot;
    this.index = new Map(snapshot.records.map(record => [record.stockCode, record]));
  }

  private async availableSnapshot(): Promise<CorpCodeIndexSnapshot> {
    if (!this.snapshot) {
      try {
        const stored = await this.store.load();
        if (stored) this.setSnapshot(stored);
      } catch {
        // A damaged local snapshot is ignored and never overwritten until a full refresh succeeds.
      }
    }
    const current = this.snapshot;
    if (current && this.age(current) <= CORP_CODE_FRESH_TTL_MS) return current;
    try {
      return await this.refreshSnapshot();
    } catch (error) {
      if (current && this.age(current) <= CORP_CODE_STALE_MAX_AGE_MS) return current;
      throw error;
    }
  }

  private refreshSnapshot(): Promise<CorpCodeIndexSnapshot> {
    if (this.refreshInFlight) return this.refreshInFlight;
    const request = (async () => {
      try {
        const records = await this.parser.parse(await this.source.fetchArchive());
        const snapshot = createCorpCodeSnapshot(records, this.now().toISOString());
        await this.store.save(snapshot);
        this.setSnapshot(snapshot);
        this.observability.record({
          operation: 'corp-code-refresh', provider: 'opendart', outcome: 'success',
          indexRecordCount: snapshot.recordCount, indexRefreshedAt: snapshot.refreshedAt,
        });
        return snapshot;
      } catch (error) {
        const openDartError = error instanceof OpenDartError
          ? error
          : new OpenDartError('CORP_CODE_INDEX_UNAVAILABLE', 'corp-code', true, undefined, { cause: error });
        this.observability.record({
          operation: 'corp-code-refresh', provider: 'opendart', outcome: 'failure',
          retryable: openDartError.retryable, providerStatus: openDartError.providerStatus,
        });
        throw openDartError;
      }
    })().finally(() => {
      if (this.refreshInFlight === request) this.refreshInFlight = undefined;
    });
    this.refreshInFlight = request;
    return request;
  }
}
