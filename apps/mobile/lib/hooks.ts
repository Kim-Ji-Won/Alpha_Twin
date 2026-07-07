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
  health: CompanyHealth;
  events: CompanyEvent[];
  distribution: ProbabilityDistribution;
  network: CompanyNetwork;
  thesis: InvestmentThesis | null; // 논제 건강도 셀 — 없으면 '없음' 표시
}

export function useCompanyTwin(symbol: string): AsyncState<CompanyTwinData> {
  return useAsync(
    async () => {
      const [quote, health, events, distribution, network, thesis] = await Promise.all([
        stockService.getQuote(symbol),
        stockService.getHealth(symbol),
        stockService.getEvents(symbol),
        stockService.getDistribution(symbol),
        stockService.getNetwork(symbol),
        thesisService.getBySymbol(symbol),
      ]);
      return { quote, health, events, distribution, network, thesis };
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
