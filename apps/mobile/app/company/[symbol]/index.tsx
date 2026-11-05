import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { DataMetadata, formatAsOf } from '@/components/DataMetadata';
import { MetricItem } from '@/components/MetricItem';
import { Panel } from '@/components/Panel';
import { SecondaryButton } from '@/components/SecondaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { StaticTabBar } from '@/components/StaticTabBar';
import { StockHeader } from '@/components/StockHeader';
import { BadgeTone, StatusBadge } from '@/components/StatusBadge';
import { NetworkGraph } from '@/components/charts/NetworkGraph';
import { Sparkline } from '@/components/charts/Sparkline';
import { SparklineRange } from '@/components/charts/sparklineRange';
import { font } from '@/lib/fonts';
import { CompanyTwinSection, useCompanyTwin } from '@/lib/hooks';
import {
  mapCompanyTwinFinancials,
} from '@/src/services/companyTwinMapper';
import { colors } from '@/src/theme';
import { CompanyMarketData, CompanyNetwork, Stock } from '@/src/types';
import {
  CompanyProfileResponseDto,
  DisclosureCorrectionType,
  DisclosureDto,
  DisclosurePageDto,
  LatestNormalizedFinancialSummaryResponseDto,
} from '@/src/types/companyTwin';

function marketStatus(metadata: CompanyMarketData['metadata']): {
  label: string;
  tone: BadgeTone;
} {
  if (metadata.stale) return { label: '이전 시세 표시 중', tone: 'warn' };
  if (metadata.partial) return { label: '일부 시세만 제공', tone: 'warn' };
  if (metadata.fallback) return { label: 'Mock 시세', tone: 'neutral' };
  if (metadata.mode === 'confirmed') return { label: '최근 확정 시세', tone: 'accent' };
  return { label: 'ALPHA TWIN API', tone: 'accent' };
}

function SectionStatePanel({
  message,
  retry,
  loading = false,
}: {
  message: string;
  retry?: () => void;
  loading?: boolean;
}) {
  return (
    <Panel style={styles.statePanel}>
      <Text
        accessibilityLiveRegion="polite"
        style={[styles.stateText, { fontFamily: font('body', '600') }]}>
        {message}
      </Text>
      {!loading && retry ? (
        <SecondaryButton label="다시 시도" onPress={retry} style={styles.retryButton} />
      ) : null}
    </Panel>
  );
}

function identityStock(
  symbol: string,
  market: CompanyTwinSection<CompanyMarketData>,
  profile: CompanyTwinSection<CompanyProfileResponseDto>,
): Stock {
  const quote = market.data?.quote;
  const company = profile.data?.company;
  if (quote) {
    return {
      ...quote,
      name: company?.displayName ?? quote.name,
      market: company?.market === 'UNKNOWN' ? quote.market : company?.market ?? quote.market,
      sector: company?.industryCode
        ? `업종코드 ${company.industryCode}`
        : quote.sector,
    };
  }
  return {
    symbol,
    name: company?.displayName ?? symbol,
    market: company?.market === 'UNKNOWN' ? undefined : company?.market,
    sector: company?.industryCode ? `업종코드 ${company.industryCode}` : '',
    price: 0,
    changePct: 0,
    healthScore: 0,
  };
}

function MarketSection({
  section,
  retry,
}: {
  section: CompanyTwinSection<CompanyMarketData>;
  retry: () => void;
}) {
  if (section.status === 'loading') {
    return <SectionStatePanel message="최근 확정 시세를 불러오는 중입니다." loading />;
  }
  if (section.status === 'error' || section.status === 'empty' || !section.data?.quote) {
    return (
      <SectionStatePanel
        message={section.errorMessage ?? '이 종목의 시세를 확인할 수 없습니다.'}
        retry={retry}
      />
    );
  }

  const { quote, candles, metadata } = section.data;
  const state = marketStatus(metadata);
  const points = candles.map(candle => ({ date: candle.date, score: candle.close }));
  const first = candles[0];
  const last = candles.at(-1);
  const publicData = metadata.dataMode === 'eod'
    || metadata.source.includes('public-data-fsc');

  return (
    <>
      <Panel style={styles.marketPanel}>
        <View style={styles.sectionHead}>
          <Text style={[styles.panelTitle, { fontFamily: font('body', '700') }]}>
            일봉 시세 · Daily
          </Text>
          <StatusBadge label={state.label} tone={state.tone} size="sm" />
        </View>
        {points.length > 0 ? (
          <NetworklessSparkline
            key={JSON.stringify([quote.symbol, quote.currency, metadata.fallback, candles])}
            candles={candles}
            symbol={quote.symbol}
            currency={quote.currency}
            mock={metadata.fallback}
            axisLeft={first?.date.slice(5).replace('-', '/')}
            axisRight={last?.date.slice(5).replace('-', '/')}
          />
        ) : (
          <Text style={[styles.emptyText, { fontFamily: font('body', '500') }]}>
            최근 일봉 데이터가 없습니다.
          </Text>
        )}
        <View style={styles.marketStats}>
          <Text style={[styles.marketStat, { fontFamily: font('mono', '500') }]}>
            거래량 {quote.volume?.toLocaleString() ?? '확인 불가'}
          </Text>
          <Text style={[styles.marketStat, { fontFamily: font('mono', '500') }]}>
            거래대금 {quote.tradingValue?.toLocaleString() ?? '확인 불가'}
            {quote.currency === 'KRW' && quote.tradingValue ? '원' : ''}
          </Text>
        </View>
      </Panel>
      <DataMetadata
        items={[
          `최근 확정 시세 기준일 ${formatAsOf(metadata.asOf)}`,
          `시세 출처 ${publicData ? '금융위원회 공공데이터' : metadata.source}`,
          publicData ? '실시간 아님' : state.label,
          metadata.priceAdjustment === 'raw' ? '원주가' : '가격 조정 정책 확인 필요',
        ]}
        style={styles.metadata}
      />
    </>
  );
}

function NetworklessSparkline({
  candles,
  symbol,
  currency,
  mock,
  axisLeft,
  axisRight,
}: {
  candles: CompanyMarketData['candles'];
  symbol: string;
  currency?: string;
  mock: boolean;
  axisLeft?: string;
  axisRight?: string;
}) {
  const router = useRouter();
  const points = useMemo(() => candles.map(candle => ({ date: candle.date, score: candle.close })), [candles]);
  const [selection, setSelection] = useState<SparklineRange | null>(null);
  const start = selection ? candles[selection.startIndex] : undefined;
  const end = selection ? candles[selection.endIndex] : undefined;
  const valid = start && end && Number.isFinite(start.close) && Number.isFinite(end.close);
  const unit = currency === 'KRW' ? '원' : currency ? ` ${currency}` : ' (통화 미확인)';
  const question = valid
    ? `${symbol}의 ${start.date}부터 ${end.date}까지의 ${mock ? 'Mock 예시 ' : ''}일봉 구간을 보고 있어.\n`
      + `시작 종가는 ${start.close}${unit}, 종료 종가는 ${end.close}${unit}이야.\n`
      + '위 날짜와 두 종가는 질문에 포함한 값이며, 구간 전체 일봉 시계열을 전달한 것은 아니야.\n'
      + '현재 제공 가능한 기업·재무·공시·시세 데이터를 기준으로 이 구간과 함께 확인할 만한 요인을 설명해줘.\n'
      + '가격 변동의 원인을 단정하지 말고, 근거가 부족하면 부족하다고 말해줘.'
    : '';
  return (
    <>
    <Sparkline
      points={points}
      height={62}
      axisLeft={axisLeft}
      axisRight={axisRight}
      accessibilityLabel={
        points.length > 0
          ? `최근 확정 일봉, ${points[0].date}부터 ${points[points.length - 1].date}까지`
          : '최근 확정 일봉 데이터 없음'
      }
      style={styles.marketChart}
      rangeSelectionEnabled
      onRangeSelected={setSelection}
    />
    {valid ? (
      <View>
        <Text accessibilityLiveRegion="polite" style={[styles.stateText, { fontFamily: font('body', '500') }]}>
          선택 구간 · {start.date} → {end.date}{'\n'}
          종가 {start.close}{unit} → {end.close}{unit}{mock ? ' · Mock 예시' : ''}
        </Text>
        <SecondaryButton label="이 구간을 AI Analyst에 질문"
          accessibilityLabel={`${symbol}, ${start.date}부터 ${end.date}까지의 구간으로 AI 질문 초안 열기`}
          onPress={() => router.navigate({ pathname: '/(tabs)/ai', params: { symbol, question } })}
        />
      </View>
    ) : null}
    </>
  );
}

function ProfileSection({
  section,
  retry,
}: {
  section: CompanyTwinSection<CompanyProfileResponseDto>;
  retry: () => void;
}) {
  if (section.status === 'loading') {
    return <SectionStatePanel message="OpenDART 기업 정보를 불러오는 중입니다." loading />;
  }
  if (section.status !== 'success' || !section.data) {
    return (
      <SectionStatePanel
        message={section.errorMessage ?? '기업 정보를 아직 제공하지 않습니다.'}
        retry={section.status === 'error' ? retry : undefined}
      />
    );
  }
  const { company, metadata } = section.data;
  return (
    <Panel>
      <View style={styles.sectionHead}>
        <Text style={[styles.panelTitle, { fontFamily: font('body', '700') }]}>기업개황</Text>
        <StatusBadge
          label={metadata.stale ? '이전 기업정보' : 'OpenDART'}
          tone={metadata.stale ? 'warn' : 'accent'}
          size="sm"
        />
      </View>
      <MetricItem label="법인명" value={company.legalName} first />
      <MetricItem label="시장" value={company.market} />
      <MetricItem label="업종코드" value={company.industryCode ?? '확인 불가'} />
      <MetricItem label="대표자" value={company.chiefExecutive ?? '확인 불가'} />
      <MetricItem
        label="결산월"
        value={company.fiscalYearEndMonth ? `${company.fiscalYearEndMonth}월` : '확인 불가'}
      />
      <DataMetadata
        items={[
          '출처 OpenDART',
          `조회 ${formatAsOf(metadata.retrievedAt)}`,
          metadata.stale ? '캐시 데이터' : '최신 조회 결과',
        ]}
        style={styles.panelMetadata}
      />
    </Panel>
  );
}

function FinancialSection({
  section,
  retry,
}: {
  section: CompanyTwinSection<LatestNormalizedFinancialSummaryResponseDto>;
  retry: () => void;
}) {
  if (section.status === 'loading') {
    return <SectionStatePanel message="최근 정기 재무보고서를 확인하는 중입니다." loading />;
  }
  if (section.status === 'empty') {
    return <SectionStatePanel message="최근 정기 재무보고서를 찾을 수 없습니다." />;
  }
  if (section.status === 'error' || !section.data) {
    return (
      <SectionStatePanel
        message={section.errorMessage ?? '재무 정보를 불러오지 못했습니다.'}
        retry={retry}
      />
    );
  }

  const viewModel = mapCompanyTwinFinancials(section.data);
  const { resolution, summary } = section.data;
  const stale = viewModel.resolutionStale || viewModel.financialStale;
  return (
    <Panel>
      <View style={styles.sectionHead}>
        <View style={styles.titleGroup}>
          <Text style={[styles.panelTitle, { fontFamily: font('body', '700') }]}>
            {viewModel.periodLabel}
          </Text>
          <Text style={[styles.panelSubtitle, { fontFamily: font('body', '500') }]}>
            {viewModel.statementDivisionLabel} · OpenDART
          </Text>
        </View>
        <StatusBadge label={stale ? '이전 데이터' : '확정 재무'} tone={stale ? 'warn' : 'accent'} size="sm" />
      </View>
      {viewModel.metrics.map((metric, index) => (
        <View
          key={metric.key}
          style={[styles.metricRow, index > 0 ? styles.rowDivider : null]}
          accessibilityLabel={`${metric.label}, ${metric.valueText}${metric.basisLabel ? `, ${metric.basisLabel}` : ''}`}>
          <View style={styles.metricLabelGroup}>
            <Text style={[styles.metricLabel, { fontFamily: font('body', '600') }]}>
              {metric.label}
            </Text>
            {metric.basisLabel ? (
              <Text style={[styles.metricBasis, { fontFamily: font('body', '500') }]}>
                {metric.basisLabel}
              </Text>
            ) : null}
          </View>
          <Text
            style={[
              styles.metricValue,
              metric.status === 'resolved' ? null : styles.metricUnavailable,
              { fontFamily: font('mono', '600') },
            ]}>
            {metric.valueText}
          </Text>
        </View>
      ))}
      {viewModel.hasWarnings ? (
        <Text style={[styles.warningText, { fontFamily: font('body', '500') }]}>
          일부 재무 항목은 원문 확인이 필요합니다.
        </Text>
      ) : null}
      <DataMetadata
        items={[
          `보고기간 ${resolution.periodEnd}`,
          `공시일 ${resolution.filing.receiptDate}`,
          `재무 출처 OpenDART`,
          `조회 ${formatAsOf(summary.metadata.retrievedAt)}`,
          ...(stale ? ['일시적으로 이전 데이터 표시 중'] : []),
        ]}
        style={styles.panelMetadata}
      />
    </Panel>
  );
}

const CORRECTION_LABEL: Record<DisclosureCorrectionType, string | null> = {
  none: null,
  'content-correction': '기재정정',
  'attachment-correction': '첨부정정',
  'attachment-added': '첨부추가',
  'registration-changed': '변경등록',
  'extension-decided': '연장결정',
  'issuance-terms-finalized': '조건확정',
  'correction-order': '정정명령',
  'correction-request': '정정요구',
  unknown: '정정',
};

async function openDisclosure(disclosure: DisclosureDto): Promise<void> {
  if (!/^https?:\/\//i.test(disclosure.viewerUrl)) return;
  await Linking.openURL(disclosure.viewerUrl);
}

function DisclosureRow({ disclosure, first }: { disclosure: DisclosureDto; first: boolean }) {
  const correction = CORRECTION_LABEL[disclosure.correctionType];
  return (
    <Pressable
      onPress={() => {
        openDisclosure(disclosure).catch(() => undefined);
      }}
      accessibilityRole="link"
      accessibilityLabel={`${disclosure.reportName}, 공시일 ${disclosure.receiptDate}`}
      style={({ pressed }) => [
        styles.disclosureRow,
        first ? null : styles.rowDivider,
        { opacity: pressed ? 0.72 : 1 },
      ]}>
      <View style={styles.disclosureContent}>
        <View style={styles.badges}>
          {correction ? <StatusBadge label={correction} tone="warn" size="sm" /> : null}
          {disclosure.isWithdrawn ? <StatusBadge label="철회" tone="neg" size="sm" /> : null}
          {disclosure.includesConsolidated ? <StatusBadge label="연결" tone="neutral" size="sm" /> : null}
          {!correction && !disclosure.isWithdrawn && !disclosure.includesConsolidated ? (
            <StatusBadge label="공시" tone="accent" size="sm" />
          ) : null}
        </View>
        <Text
          numberOfLines={2}
          style={[styles.disclosureTitle, { fontFamily: font('body', '700') }]}>
          {disclosure.reportName}
        </Text>
        <Text style={[styles.disclosureDate, { fontFamily: font('mono', '500') }]}>
          {disclosure.receiptDate}
        </Text>
      </View>
      <Text style={[styles.linkArrow, { fontFamily: font('mono', '600') }]}>↗</Text>
    </Pressable>
  );
}

function DisclosureSection({
  section,
  retry,
}: {
  section: CompanyTwinSection<DisclosurePageDto>;
  retry: () => void;
}) {
  if (section.status === 'loading') {
    return <SectionStatePanel message="최근 공시를 불러오는 중입니다." loading />;
  }
  if (section.status === 'empty') {
    return <SectionStatePanel message="최근 공시가 없습니다." />;
  }
  if (section.status === 'error' || !section.data) {
    return (
      <SectionStatePanel
        message={section.errorMessage ?? '공시 정보를 불러오지 못했습니다.'}
        retry={retry}
      />
    );
  }
  const visible = section.data.items.slice(0, 5);
  return (
    <Panel>
      <View style={styles.sectionHead}>
        <Text style={[styles.panelTitle, { fontFamily: font('body', '700') }]}>최근 공시</Text>
        <StatusBadge
          label={section.data.metadata.stale ? '이전 공시' : 'OpenDART'}
          tone={section.data.metadata.stale ? 'warn' : 'accent'}
          size="sm"
        />
      </View>
      {visible.map((disclosure, index) => (
        <DisclosureRow
          key={disclosure.receiptNumber}
          disclosure={disclosure}
          first={index === 0}
        />
      ))}
      <DataMetadata
        items={[
          `최근 ${visible.length}건 표시`,
          `조회 ${formatAsOf(section.data.metadata.retrievedAt)}`,
          '항목을 누르면 OpenDART 원문 열기',
        ]}
        style={styles.panelMetadata}
      />
    </Panel>
  );
}

function previewNetwork(symbol: string, name: string): CompanyNetwork {
  return {
    center: { id: symbol, label: name },
    nodes: [
      { id: 'customers', label: '고객 관계', group: 'customer', sub: '준비 중' },
      { id: 'suppliers', label: '공급망', group: 'supplier', sub: '준비 중' },
      { id: 'competitors', label: '경쟁 관계', group: 'competitor', sub: '준비 중' },
      { id: 'products', label: '핵심 제품', group: 'product', sub: '준비 중' },
      { id: 'macro', label: '거시 변수', group: 'macro', sub: '준비 중' },
    ],
    edges: [
      { from: symbol, to: 'customers', weight: 0.1, note: '관계 분석 엔진 연결 예정' },
      { from: symbol, to: 'suppliers', weight: 0.1, note: '관계 분석 엔진 연결 예정' },
      { from: symbol, to: 'competitors', weight: 0.1, note: '관계 분석 엔진 연결 예정' },
      { from: symbol, to: 'products', weight: 0.1, note: '관계 분석 엔진 연결 예정' },
      { from: symbol, to: 'macro', weight: 0.1, note: '관계 분석 엔진 연결 예정' },
    ],
  };
}

export default function CompanyTwinRoute() {
  const router = useRouter();
  const { symbol: rawSymbol } = useLocalSearchParams<{ symbol: string }>();
  const symbol = rawSymbol ?? '';
  const twin = useCompanyTwin(symbol);
  const validSymbol = /^\d{6}$/.test(symbol);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/home');
  };

  if (!validSymbol) {
    return (
      <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <SectionStatePanel message="잘못된 종목 코드입니다." />
        <SecondaryButton label="돌아가기" onPress={goBack} />
      </AppScreen>
    );
  }

  const stock = identityStock(symbol, twin.market, twin.profile);
  const priceState = twin.market.data?.quote
    ? 'ready'
    : twin.market.status === 'loading'
      ? 'loading'
      : 'unavailable';
  const companyName = twin.profile.data?.company.displayName
    ?? twin.market.data?.quote?.name
    ?? symbol;
  const network = previewNetwork(symbol, companyName);

  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
      {/* Keep edge-back navigation without iOS 26 full-screen swipe stealing chart drags. */}
      <Stack.Screen options={{ fullScreenGestureEnabled: false }} />
      <StockHeader stock={stock} priceState={priceState} onBack={goBack} />

      <View style={styles.refreshRow}>
        <Text style={[styles.refreshLabel, { fontFamily: font('body', '500') }]}>
          시장·기업·공시·재무 데이터는 독립적으로 갱신됩니다.
        </Text>
        <SecondaryButton
          label={twin.refreshing ? '갱신 중' : '새로고침'}
          onPress={twin.reload}
          disabled={twin.refreshing}
          style={styles.refreshButton}
        />
      </View>

      <SectionHeader label="시장 데이터 · Market" meta="최근 확정 시세" />
      <MarketSection section={twin.market} retry={twin.reload} />

      <SectionHeader label="기업 정보 · Profile" meta="OpenDART" />
      <ProfileSection section={twin.profile} retry={twin.reload} />

      <SectionHeader label="재무 요약 · Financials" meta="8개 표준 항목" />
      <FinancialSection section={twin.financials} retry={twin.reload} />

      <SectionHeader label="공시 · Disclosures" meta="최근 5건" />
      <DisclosureSection section={twin.disclosures} retry={twin.reload} />

      <SectionHeader label="기업 상태 · Company Health" meta="준비 중" />
      <Panel>
        <StatusBadge label="분석 엔진 연결 예정" tone="neutral" size="sm" />
        <Text style={[styles.pendingTitle, { fontFamily: font('body', '700') }]}>
          Company Health 분석 준비 중
        </Text>
        <Text style={[styles.pendingBody, { fontFamily: font('body', '500') }]}>
          실제 재무·공시 기반 계산 엔진이 연결되기 전까지 점수와 판정을 표시하지 않습니다.
        </Text>
      </Panel>

      <SectionHeader label="미래 확률 · Probability" meta="준비 중" />
      <Panel>
        <StatusBadge label="확률 모델 미연결" tone="neutral" size="sm" />
        <Text style={[styles.pendingTitle, { fontFamily: font('body', '700') }]}>
          시나리오 엔진 준비 중
        </Text>
        <Text style={[styles.pendingBody, { fontFamily: font('body', '500') }]}>
          미래 수익률과 낙폭 확률은 검증된 모델이 연결된 이후 제공됩니다.
        </Text>
      </Panel>

      <SectionHeader label="기업 관계 지도 · Network" meta="UI 미리보기" />
      <View style={styles.networkNotice}>
        <StatusBadge label="분석 데이터 아님" tone="warn" size="sm" />
        <Text style={[styles.networkNoticeText, { fontFamily: font('body', '500') }]}>
          그래프 탐색 기능 미리보기입니다. 실제 관계·위험 분석은 아직 제공되지 않습니다.
        </Text>
      </View>
      <NetworkGraph network={network} />

      <SectionHeader label="경영진 분석 · Management" meta="준비 중" />
      <Panel>
        <Text style={[styles.pendingTitleNoBadge, { fontFamily: font('body', '700') }]}>
          Management Track Record 준비 중
        </Text>
        <Text style={[styles.pendingBody, { fontFamily: font('body', '500') }]}>
          대표자 정보와 경영진 성과 분석은 별개이며, 현재 성과 점수는 제공하지 않습니다.
        </Text>
      </Panel>

      <SecondaryButton
        label="AI Analyst에서 이 기업 분석"
        onPress={() =>
          router.navigate({ pathname: '/(tabs)/ai', params: { symbol } })
        }
        style={styles.aiAction}
      />
      <View style={styles.actions}>
        <SecondaryButton
          label="Scenario Lab 준비 중"
          onPress={() => undefined}
          disabled
          style={styles.action}
        />
        <SecondaryButton
          label="투자 논제"
          onPress={() =>
            router.push({ pathname: '/thesis/[symbol]', params: { symbol } })
          }
          style={styles.action}
        />
      </View>

      <DataMetadata
        items={[
          '시장 데이터 금융위원회 공공데이터',
          '기업·공시·재무 OpenDART',
          '분석 점수·확률·경영진 평가는 현재 미제공',
        ]}
        style={styles.footerMetadata}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  marketPanel: { marginBottom: 8 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  titleGroup: { flex: 1 },
  panelTitle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  panelSubtitle: { fontSize: 11.5, color: colors.mut, marginTop: 3 },
  marketChart: { marginTop: 6 },
  marketStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
  },
  marketStat: { fontSize: 10.5, color: colors.dim, flexShrink: 1 },
  metadata: { marginBottom: 4 },
  panelMetadata: { marginTop: 10, paddingHorizontal: 0 },
  statePanel: { minHeight: 88, justifyContent: 'center' },
  stateText: { fontSize: 13, lineHeight: 20, color: colors.mut },
  retryButton: { marginTop: 12, minHeight: 42, alignSelf: 'flex-start' },
  emptyText: { color: colors.mut, fontSize: 13, paddingVertical: 20, textAlign: 'center' },
  metricRow: {
    minHeight: 48,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  metricLabelGroup: { flex: 1, minWidth: 0 },
  metricLabel: { fontSize: 13, color: colors.mut },
  metricBasis: { fontSize: 10.5, color: colors.dim, marginTop: 2 },
  metricValue: {
    maxWidth: '58%',
    fontSize: 12,
    lineHeight: 18,
    color: colors.ink,
    textAlign: 'right',
  },
  metricUnavailable: { color: colors.warn },
  warningText: {
    color: colors.warn,
    fontSize: 11.5,
    lineHeight: 18,
    marginTop: 8,
  },
  disclosureRow: {
    minHeight: 70,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  disclosureContent: { flex: 1, minWidth: 0 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  disclosureTitle: { color: colors.ink, fontSize: 13.5, lineHeight: 19, marginTop: 6 },
  disclosureDate: { color: colors.dim, fontSize: 10.5, marginTop: 4 },
  linkArrow: { color: colors.accent, fontSize: 16 },
  pendingTitle: { color: colors.ink, fontSize: 14, marginTop: 12 },
  pendingTitleNoBadge: { color: colors.ink, fontSize: 14 },
  pendingBody: { color: colors.mut, fontSize: 13, lineHeight: 20, marginTop: 6 },
  networkNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginVertical: 8,
    paddingHorizontal: 2,
  },
  networkNoticeText: { flex: 1, color: colors.mut, fontSize: 11.5, lineHeight: 18 },
  refreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 4,
  },
  refreshLabel: { flex: 1, color: colors.dim, fontSize: 10.5, lineHeight: 16 },
  refreshButton: { minHeight: 38, paddingVertical: 8, paddingHorizontal: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  aiAction: { marginTop: 8 },
  action: { flex: 1 },
  footerMetadata: { marginTop: 14 },
});
