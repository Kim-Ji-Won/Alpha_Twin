// 화면별 데이터 훅 — 화면은 이 훅만 사용하고 서비스/Mock을 직접 부르지 않는다.
import {
  marketService,
  scenarioService,
  stockService,
  thesisService,
} from '@/src/services';
import { AsyncState, useAsync } from '@/lib/useAsync';
import {
  AnomalySignal,
  CompanyEvent,
  CompanyHealth,
  CompanyMarketData,
  CompanyNetwork,
  InvestmentThesis,
  MarketRegime,
  PortfolioImpactNotice,
  ProbabilityDistribution,
  Stock,
} from '@/src/types';

export interface MarketBrainData {
  regime: MarketRegime;
  events: CompanyEvent[];
  netFlow: Awaited<ReturnType<typeof marketService.getNetFlow>>;
  sectors: Awaited<ReturnType<typeof marketService.getSectors>>;
  portfolioImpact: PortfolioImpactNotice;
  anomalies: AnomalySignal[];
}

export function useMarketBrain(): AsyncState<MarketBrainData> {
  return useAsync(
    async () => {
      const [regime, events, netFlow, sectors, portfolioImpact, anomalies] = await Promise.all([
        marketService.getRegime(),
        marketService.getKeyEvents(),
        marketService.getNetFlow(),
        marketService.getSectors(),
        marketService.getPortfolioImpact(),
        marketService.getAnomalies(),
      ]);
      return { regime, events, netFlow, sectors, portfolioImpact, anomalies };
    },
    [],
    { isEmpty: () => false },
  );
}

export interface CompanyTwinData {
  quote: Stock | null;
  marketData: CompanyMarketData;
  health: CompanyHealth | null;
  events: CompanyEvent[] | null;
  distribution: ProbabilityDistribution | null;
  network: CompanyNetwork | null;
  thesis: InvestmentThesis | null; // 논제 건강도 셀 — 없으면 '없음' 표시
}

export function useCompanyTwin(symbol: string): AsyncState<CompanyTwinData> {
  return useAsync(
    async () => {
      const [marketData, health, events, distribution, network, thesis] = await Promise.all([
        stockService.getCompanyMarketData(symbol),
        stockService.getHealth(symbol),
        stockService.getEvents(symbol),
        stockService.getDistribution(symbol),
        stockService.getNetwork(symbol),
        thesisService.getBySymbol(symbol),
      ]);
      return { quote: marketData.quote, marketData, health, events, distribution, network, thesis };
    },
    [symbol],
    { isEmpty: d => d.quote == null, reloadOnFocus: true },
  );
}

// 논제는 편집 화면에서 돌아올 때 최신 저장본을 반영해야 하므로 focus마다 재조회.
// 논제가 없는 종목은 empty 상태 → 작성 유도 화면.
export function useThesis(symbol: string): AsyncState<InvestmentThesis | null> {
  return useAsync(() => thesisService.getBySymbol(symbol), [symbol], {
    isEmpty: t => t == null,
    reloadOnFocus: true,
  });
}

export function useScenarioResult(scenarioId: string) {
  return useAsync(() => scenarioService.run(scenarioId), [scenarioId], {
    isEmpty: () => false,
  });
}

export function useQuote(symbol: string): AsyncState<Stock | null> {
  return useAsync(() => stockService.getQuote(symbol), [symbol], {
    isEmpty: q => q == null,
  });
}

// ── P2 훅 ─────────────────────────────────────────────────────────────────
import {
  aiService,
  discoverService,
  managementService,
  notificationService,
  portfolioService,
  settingsService,
  watchlistService,
} from '@/src/services';
import {
  AIAnalysis,
  AppNotification,
  DiscoverSignal,
  IndustryTwin,
  ManagementRecord,
  NarrativeGapItem,
  Portfolio,
  PortfolioHolding,
  PortfolioRisk,
  UserProfile,
} from '@/src/types';

export interface PortfolioXrayData {
  portfolio: Portfolio;
  risk: PortfolioRisk;
}

// 종목 관리에서 돌아오면 X-Ray가 즉시 갱신되어야 하므로 focus마다 재조회.
export function usePortfolioXray(): AsyncState<PortfolioXrayData> {
  return useAsync(
    async () => {
      const [portfolio, risk] = await Promise.all([portfolioService.get(), portfolioService.getRisk()]);
      return { portfolio, risk };
    },
    [],
    { isEmpty: d => d.portfolio.holdings.length === 0, reloadOnFocus: true },
  );
}

export function useHoldings(): AsyncState<Portfolio> {
  return useAsync(() => portfolioService.get(), [], {
    isEmpty: p => p.holdings.length === 0,
    reloadOnFocus: true,
  });
}

export function useHolding(symbol: string): AsyncState<PortfolioHolding | null> {
  return useAsync(() => portfolioService.getHolding(symbol), [symbol], {
    isEmpty: h => h == null,
  });
}

export interface DiscoverData {
  signals: DiscoverSignal[];
  industries: IndustryTwin[];
  narrativeGaps: NarrativeGapItem[];
}

export function useDiscover(): AsyncState<DiscoverData> {
  return useAsync(
    async () => {
      const [signals, industries, narrativeGaps] = await Promise.all([
        discoverService.getSignals(),
        discoverService.getIndustries(),
        discoverService.getNarrativeGaps(),
      ]);
      return { signals, industries, narrativeGaps };
    },
    [],
    { isEmpty: () => false },
  );
}

export function useNotifications(): AsyncState<AppNotification[]> {
  return useAsync(() => notificationService.list(), [], {
    isEmpty: list => list.length === 0,
    reloadOnFocus: true,
  });
}

export interface WatchlistEntry {
  stock: Stock;
  thesis: InvestmentThesis | null;
}

export function useWatchlist(): AsyncState<WatchlistEntry[]> {
  return useAsync(
    async () => {
      const stocks = await watchlistService.list();
      const theses = await Promise.all(stocks.map(s => thesisService.getBySymbol(s.symbol)));
      return stocks.map((stock, i) => ({ stock, thesis: theses[i] }));
    },
    [],
    { isEmpty: list => list.length === 0, reloadOnFocus: true },
  );
}

export function useManagement(symbol: string): AsyncState<ManagementRecord> {
  return useAsync(() => managementService.get(symbol), [symbol], { isEmpty: () => false });
}

export function useAnalysis(analysisId: string): AsyncState<AIAnalysis> {
  return useAsync(() => aiService.getAnalysis(analysisId), [analysisId], {
    isEmpty: () => false,
  });
}

export interface ProfileStats {
  profile: UserProfile;
  twinCount: number;
  thesisCount: number;
  holdingCount: number;
  scenarioCount: number;
}

export function useProfile(): AsyncState<ProfileStats> {
  return useAsync(
    async () => {
      const [profile, watch, theses, portfolio] = await Promise.all([
        settingsService.getProfile(),
        watchlistService.list(),
        thesisService.listForUser(),
        portfolioService.get(),
      ]);
      return {
        profile,
        twinCount: watch.length,
        thesisCount: theses.length,
        holdingCount: portfolio.holdings.length,
        scenarioCount: 12, // Mock 통계 (프레임 25)
      };
    },
    [],
    { isEmpty: () => false, reloadOnFocus: true },
  );
}
