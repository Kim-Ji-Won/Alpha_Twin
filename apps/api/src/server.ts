import { buildApp } from './app.js';
import { MemoryCache } from './cache.js';
import { loadConfig } from './config.js';
import { MarketDataService } from './marketDataService.js';
import { MockMarketDataProvider } from './providers/mockMarketDataProvider.js';
import { PlaceholderLiveMarketDataProvider } from './providers/placeholderLiveMarketDataProvider.js';

const config = loadConfig();
const mockProvider = new MockMarketDataProvider();
const provider = config.provider === 'live'
  ? new PlaceholderLiveMarketDataProvider(config)
  : mockProvider;
const marketData = new MarketDataService(provider, mockProvider, new MemoryCache(), config.allowMockFallback);
const app = await buildApp(config, marketData);

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`ALPHA TWIN API listening on http://${config.host}:${config.port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
