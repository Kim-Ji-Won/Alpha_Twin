import { AppConfig } from '../config.js';
import { CandleRange, StockCandleDto, StockQuoteDto } from '../contracts.js';
import { MarketDataProvider } from './marketDataProvider.js';

export class PlaceholderLiveMarketDataProvider implements MarketDataProvider {
  readonly id = 'live-provider-placeholder';
  readonly isFallback = false;
  readonly dataMode = 'realtime' as const;
  readonly priceAdjustment = 'unknown' as const;

  constructor(private readonly config: AppConfig) {}

  private assertConfigured(): never {
    if (!this.config.marketDataBaseUrl || !this.config.marketDataApiKey) {
      throw new Error('Live market data provider credentials are not configured');
    }
    throw new Error('Live market data provider adapter is not implemented yet');
  }

  async getQuote(_symbol: string): Promise<StockQuoteDto> {
    return this.assertConfigured();
  }

  async getDailyCandles(_symbol: string, _range: CandleRange): Promise<StockCandleDto[]> {
    return this.assertConfigured();
  }
}
