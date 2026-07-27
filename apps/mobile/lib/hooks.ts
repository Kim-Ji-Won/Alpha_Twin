// 화면별 데이터 훅 — 화면은 이 훅만 사용하고 서비스/Mock을 직접 부르지 않는다.
import { useFocusEffect } from 'expo-router';
import { Dispatch, SetStateAction, useCallback, useRef, useState } from 'react';

import {
  marketService,
  scenarioService,
  stockService,
  thesisService,
} from '@/src/services';
import {
  alphaTwinApi,
  AlphaTwinApiError,
  StockQuoteDto,
} from '@/src/services/alphaTwinApi';
import { AsyncState, AsyncStatus, useAsync } from '@/lib/useAsync';
import {
  AnomalySignal,
  CompanyEvent,
  CompanyMarketData,
  InvestmentThesis,
  MarketRegime,
  PortfolioImpactNotice,
  Stock,
} from '@/src/types';
import {
  CompanyProfileResponseDto,
  DisclosurePageDto,
  LatestNormalizedFinancialSummaryResponseDto,
} from '@/src/types/companyTwin';

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

export type CompanyTwinSectionStatus = 'loading' | 'success' | 'empty' | 'error';

export interface CompanyTwinSection<T> {
  status: CompanyTwinSectionStatus;
  data: T | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface CompanyTwinData {
  market: CompanyTwinSection<CompanyMarketData>;
  profile: CompanyTwinSection<CompanyProfileResponseDto>;
  disclosures: CompanyTwinSection<DisclosurePageDto>;
  financials: CompanyTwinSection<LatestNormalizedFinancialSummaryResponseDto>;
  refreshing: boolean;
  reload: () => void;
}

function loadingSection<T>(): CompanyTwinSection<T> {
  return { status: 'loading', data: null, errorCode: null, errorMessage: null };
}

function userMessage(error: unknown): { code: string; message: string } {
  const code = error instanceof AlphaTwinApiError ? error.code : 'UNKNOWN_ERROR';
  if (code === 'INVALID_SYMBOL') return { code, message: '잘못된 종목 코드입니다.' };
  if (code === 'CORP_CODE_NOT_FOUND') {
    return { code, message: '이 종목의 기업 정보는 아직 준비 중입니다.' };
  }
  if (code === 'OPENDART_NOT_CONFIGURED' || code === 'API_NOT_CONFIGURED') {
    return { code, message: '기업 데이터 서비스 연결이 필요합니다.' };
  }
  if (
    code === 'FINANCIAL_REPORT_NOT_FOUND'
    || code === 'LATEST_FINANCIAL_REPORT_NOT_FOUND'
  ) {
    return { code, message: '최근 정기 재무보고서를 찾을 수 없습니다.' };
  }
  if (
    code === 'OPENDART_TIMEOUT'
    || code === 'OPENDART_UNAVAILABLE'
    || code === 'NETWORK_UNAVAILABLE'
  ) {
    return { code, message: '데이터를 일시적으로 불러올 수 없습니다.' };
  }
  if (
    code === 'LATEST_FINANCIAL_REPORT_UNRESOLVED'
    || code === 'LATEST_FINANCIAL_REPORT_RESPONSE_INCONSISTENT'
    || code === 'LATEST_FINANCIAL_REPORT_RECEIPT_MISMATCH'
    || code === 'INVALID_API_RESPONSE'
  ) {
    return { code, message: '데이터 확인 중 문제가 발생했습니다.' };
  }
  return { code, message: '데이터를 불러오지 못했습니다.' };
}

async function loadCompanyTwinSection<T>(
  load: () => Promise<T>,
  setState: Dispatch<SetStateAction<CompanyTwinSection<T>>>,
  active: () => boolean,
  isEmpty: (data: T) => boolean = () => false,
): Promise<void> {
  try {
    const data = await load();
    if (!active()) return;
    setState({
      status: isEmpty(data) ? 'empty' : 'success',
      data,
      errorCode: null,
      errorMessage: null,
    });
  } catch (error) {
    if (!active()) return;
    const mapped = userMessage(error);
    const empty = mapped.code === 'FINANCIAL_REPORT_NOT_FOUND'
      || mapped.code === 'LATEST_FINANCIAL_REPORT_NOT_FOUND'
      || mapped.code === 'CORP_CODE_NOT_FOUND';
    setState({
      status: empty ? 'empty' : 'error',
      data: null,
      errorCode: mapped.code,
      errorMessage: mapped.message,
    });
  }
}

export function useCompanyTwin(symbol: string): CompanyTwinData {
  const [market, setMarket] =
    useState<CompanyTwinSection<CompanyMarketData>>(loadingSection);
  const [profile, setProfile] =
    useState<CompanyTwinSection<CompanyProfileResponseDto>>(loadingSection);
  const [disclosures, setDisclosures] =
    useState<CompanyTwinSection<DisclosurePageDto>>(loadingSection);
  const [financials, setFinancials] =
    useState<CompanyTwinSection<LatestNormalizedFinancialSummaryResponseDto>>(loadingSection);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const requestGeneration = useRef(0);
  const inFlight = useRef(false);

  useFocusEffect(
    useCallback(() => {
      const generation = requestGeneration.current + 1;
      requestGeneration.current = generation;
      const controller = new AbortController();
      const active = () =>
        !controller.signal.aborted && requestGeneration.current === generation;

      setMarket(loadingSection());
      setProfile(loadingSection());
      setDisclosures(loadingSection());
      setFinancials(loadingSection());
      setRefreshing(true);
      inFlight.current = true;

      if (!/^\d{6}$/.test(symbol)) {
        const invalid = {
          status: 'error' as const,
          data: null,
          errorCode: 'INVALID_SYMBOL',
          errorMessage: '잘못된 종목 코드입니다.',
        };
        setMarket(invalid);
        setProfile(invalid);
        setDisclosures(invalid);
        setFinancials(invalid);
        setRefreshing(false);
        inFlight.current = false;
        return () => controller.abort();
      }

      const requests = [
        loadCompanyTwinSection(
          () => stockService.getCompanyMarketData(symbol, controller.signal),
          setMarket,
          active,
          data => data.quote == null,
        ),
        loadCompanyTwinSection(
          () => alphaTwinApi.getCompanyProfile(symbol, controller.signal),
          setProfile,
          active,
        ),
        loadCompanyTwinSection(
          () => alphaTwinApi.getCompanyDisclosures(symbol, controller.signal),
          setDisclosures,
          active,
          data => data.items.length === 0,
        ),
        loadCompanyTwinSection(
          () => alphaTwinApi.getLatestNormalizedFinancials(symbol, controller.signal),
          setFinancials,
          active,
        ),
      ];

      Promise.allSettled(requests).then(() => {
        if (!active()) return;
        setRefreshing(false);
        inFlight.current = false;
      });

      return () => {
        controller.abort();
        if (requestGeneration.current === generation) inFlight.current = false;
      };
    }, [symbol, refreshKey]),
  );

  const reload = useCallback(() => {
    if (inFlight.current) return;
    setRefreshKey(key => key + 1);
  }, []);

  return { market, profile, disclosures, financials, refreshing, reload };
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
  discoverService,
  managementService,
  notificationService,
  portfolioService,
  settingsService,
  watchlistService,
} from '@/src/services';
import {
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
  symbol: string;
  name: string;
  sector: string;
  savedOrder: number;
  thesisExists: boolean;
  market: {
    status: 'loading' | 'success' | 'error';
    quote: StockQuoteDto | null;
  };
}

export interface WatchlistState {
  status: AsyncStatus;
  data: WatchlistEntry[] | null;
  error: string | null;
  refreshing: boolean;
  reload: () => void;
}

export function useWatchlist(): WatchlistState {
  const [status, setStatus] = useState<AsyncStatus>('loading');
  const [data, setData] = useState<WatchlistEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestGeneration = useRef(0);
  const inFlight = useRef(false);

  useFocusEffect(
    useCallback(() => {
      const generation = requestGeneration.current + 1;
      requestGeneration.current = generation;
      const controller = new AbortController();
      const active = () =>
        !controller.signal.aborted && requestGeneration.current === generation;

      setStatus('loading');
      setData(null);
      setError(null);
      setRefreshing(true);
      inFlight.current = true;

      void (async () => {
        try {
          const savedStocks = await watchlistService.list();
          if (!active()) return;

          const uniqueStocks = Array.from(
            new Map(savedStocks.map(stock => [stock.symbol, stock])).values(),
          );
          const storedTheses = await Promise.all(
            uniqueStocks.map(stock => thesisService.getStoredBySymbol(stock.symbol)),
          );
          if (!active()) return;

          const initialEntries: WatchlistEntry[] = uniqueStocks.map((stock, index) => ({
            symbol: stock.symbol,
            name: stock.name,
            sector: stock.sector,
            savedOrder: index,
            thesisExists: storedTheses[index] != null,
            market: { status: 'loading', quote: null },
          }));

          setData(initialEntries);
          setStatus(initialEntries.length === 0 ? 'empty' : 'success');

          await Promise.allSettled(
            initialEntries.map(async entry => {
              try {
                const summary = await alphaTwinApi.getStockSummary(
                  entry.symbol,
                  controller.signal,
                );
                if (!active()) return;
                setData(current =>
                  current?.map(item =>
                    item.symbol === entry.symbol
                      ? {
                          ...item,
                          name: summary.quote.name || item.name,
                          market: { status: 'success', quote: summary.quote },
                        }
                      : item,
                  ) ?? null,
                );
              } catch {
                if (!active()) return;
                setData(current =>
                  current?.map(item =>
                    item.symbol === entry.symbol
                      ? { ...item, market: { status: 'error', quote: null } }
                      : item,
                  ) ?? null,
                );
              }
            }),
          );
        } catch (loadError) {
          if (!active()) return;
          setStatus('error');
          setData(null);
          setError(
            loadError instanceof Error
              ? loadError.message
              : '저장한 트윈을 불러오지 못했습니다.',
          );
        } finally {
          if (!active()) return;
          setRefreshing(false);
          inFlight.current = false;
        }
      })();

      return () => {
        controller.abort();
        if (requestGeneration.current === generation) inFlight.current = false;
      };
    }, [refreshKey]),
  );

  const reload = useCallback(() => {
    if (inFlight.current) return;
    setRefreshKey(key => key + 1);
  }, []);

  return { status, data, error, refreshing, reload };
}

export function useManagement(symbol: string): AsyncState<ManagementRecord> {
  return useAsync(() => managementService.get(symbol), [symbol], { isEmpty: () => false });
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
