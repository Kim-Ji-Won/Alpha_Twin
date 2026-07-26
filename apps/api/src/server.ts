import { buildApp } from './app.js';
import { MemoryCache } from './cache.js';
import { loadConfig } from './config.js';
import { MarketDataService } from './marketDataService.js';
import { MarketDataObservability } from './observability.js';
import { MockMarketDataProvider } from './providers/mockMarketDataProvider.js';
import { PlaceholderLiveMarketDataProvider } from './providers/placeholderLiveMarketDataProvider.js';
import { PublicDataMarketDataProvider } from './providers/publicDataMarketDataProvider.js';
import { CorpCodeArchiveParser } from './openDart/corpCode/corpCodeArchiveParser.js';
import { HttpCorpCodeArchiveSource } from './openDart/corpCode/corpCodeArchiveSource.js';
import { FileCorpCodeIndexStore } from './openDart/corpCode/corpCodeIndexStore.js';
import { CorpCodeResolver } from './openDart/corpCode/corpCodeResolver.js';
import { OpenDartHttpClient } from './openDart/openDartHttpClient.js';
import { LatestFinancialReportResolver } from './openDart/latestFinancial/latestFinancialReportResolver.js';
import { LatestFinancialService } from './openDart/latestFinancial/latestFinancialService.js';
import { FinancialAccountNormalizer } from './openDart/normalization/accountNormalizer.js';
import { OpenDartFinancialService } from './openDart/openDartFinancialService.js';
import { OpenDartService } from './openDart/openDartService.js';
import { OpenDartObservability } from './openDart/observability.js';
import { OpenDartFinancialStatementProvider } from './openDart/providers/financialStatementProvider.js';
import { OpenDartProvider } from './openDart/providers/openDartProvider.js';

const config = loadConfig();
const observability = new MarketDataObservability();
const mockProvider = new MockMarketDataProvider();
const provider = config.provider === 'public-data'
  ? new PublicDataMarketDataProvider(config, globalThis.fetch, () => new Date(), observability)
  : config.provider === 'live-placeholder'
    ? new PlaceholderLiveMarketDataProvider(config)
    : mockProvider;
const marketData = new MarketDataService(
  provider,
  mockProvider,
  new MemoryCache(Date.now, config.cacheMaxEntries),
  config.allowMockFallback,
  observability,
);
const openDartObservability = new OpenDartObservability();
const openDartClient = new OpenDartHttpClient({
  apiKey: config.openDartApiKey,
  baseUrl: config.openDartBaseUrl,
  timeoutMs: config.openDartTimeoutMs,
});
const corpCodeResolver = new CorpCodeResolver(
  new HttpCorpCodeArchiveSource({
    apiKey: config.openDartApiKey,
    baseUrl: config.openDartBaseUrl,
    timeoutMs: config.openDartArchiveTimeoutMs,
  }),
  new CorpCodeArchiveParser(),
  new FileCorpCodeIndexStore(config.openDartIndexCacheDir),
  () => new Date(),
  openDartObservability,
);
const openDartProvider = new OpenDartProvider(openDartClient);
const openDart = new OpenDartService(
  corpCodeResolver,
  openDartProvider,
  new MemoryCache(Date.now, config.cacheMaxEntries),
  () => new Date(),
  openDartObservability,
);
const openDartFinancial = new OpenDartFinancialService(
  corpCodeResolver,
  new OpenDartFinancialStatementProvider(openDartClient),
  new MemoryCache(Date.now, config.cacheMaxEntries),
  () => new Date(),
  new OpenDartObservability(),
);
const financialNormalizer = new FinancialAccountNormalizer();
const latestFinancial = new LatestFinancialService(
  new LatestFinancialReportResolver(
    corpCodeResolver,
    openDart,
    openDartProvider,
    new MemoryCache(Date.now, config.cacheMaxEntries),
    () => new Date(),
    new OpenDartObservability(),
  ),
  openDartFinancial,
  financialNormalizer,
);
const app = await buildApp(config, marketData, {
  openDart,
  openDartFinancial,
  openDartFinancialNormalizer: financialNormalizer,
  latestFinancial,
});

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`ALPHA TWIN API listening on http://${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
