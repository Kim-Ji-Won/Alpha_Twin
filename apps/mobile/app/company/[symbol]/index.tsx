// Frame 02 — Company Twin: 기업 트윈 종합.
// 종목 헤더 + 점수 스트립 + AI 요약 + 레이더/상태 영역 + 확률/이벤트 폴드 + 관계 지도.
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { DataMetadata, formatAsOf } from '@/components/DataMetadata';
import { EventRow } from '@/components/EventRow';
import { FactorRow } from '@/components/FactorRow';
import { FoldSection } from '@/components/FoldSection';
import { Panel } from '@/components/Panel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScoreMetric } from '@/components/ScoreMetric';
import { SecondaryButton } from '@/components/SecondaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { StaticTabBar } from '@/components/StaticTabBar';
import { StockHeader } from '@/components/StockHeader';
import { BadgeTone, StatusBadge } from '@/components/StatusBadge';
import { HealthRadarChart } from '@/components/charts/HealthRadarChart';
import { NetworkGraph } from '@/components/charts/NetworkGraph';
import { RichText } from '@/components/RichText';
import { ProbabilityChart } from '@/components/charts/ProbabilityChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { signed } from '@/lib/direction';
import { font } from '@/lib/fonts';
import { useCompanyTwin } from '@/lib/hooks';
import { colors } from '@/src/theme';
import { HealthArea, MarketDataMetadata, Severity } from '@/src/types';

// 프레임 02의 기업 상태 6개 항목 (레이더 + 상태 바)
const RADAR_KEYS: HealthArea['key'][] = [
  'growth',
  'profitability',
  'stability',
  'valuation',
  'flow',
  'momentum',
];

const SEVERITY_TEXT: Record<Severity, { label: string; color: string }> = {
  high: { label: '높음', color: colors.neg },
  medium: { label: '보통', color: colors.warn },
  low: { label: '낮음', color: colors.pos },
};

const CONFIDENCE_TEXT: Record<'high' | 'medium' | 'low', string> = {
  high: '높음',
  medium: '보통',
  low: '낮음',
};

function scoreTone(score: number): string {
  if (score >= 75) return colors.pos;
  if (score >= 55) return colors.accent;
  return colors.warn;
}

function marketStatus(metadata: MarketDataMetadata): { label: string; tone: BadgeTone } {
  if (metadata.stale) return { label: '최신 데이터가 아닐 수 있음', tone: 'warn' };
  if (metadata.partial) return { label: '일부 시세만 최신', tone: 'warn' };
  if (metadata.fallback) return { label: 'Mock Data로 표시 중', tone: 'neutral' };
  if (metadata.mode === 'confirmed') return { label: '최근 확정 시세', tone: 'accent' };
  return { label: 'ALPHA TWIN API', tone: 'accent' };
}

export default function CompanyTwinRoute() {
  const router = useRouter();
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const { status, data, reload } = useCompanyTwin(symbol ?? '');

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/home');
  };

  if (status === 'loading') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <LoadingState stage={`기업 트윈 동기화 중 · ${symbol ?? ''}`} />
      </AppScreen>
    );
  }
  if (status === 'error') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <ErrorState onRetry={reload} />
      </AppScreen>
    );
  }
  if (status === 'empty' || !data || !data.quote) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <EmptyState
          title="종목을 찾을 수 없어요"
          message={`'${symbol}' 종목 정보가 없습니다. 검색으로 다시 시도해 보세요.`}
          actionLabel="돌아가기"
          onAction={goBack}
        />
      </AppScreen>
    );
  }

  const { quote, marketData, health, events, distribution, network, thesis } = data;
  const risk = SEVERITY_TEXT[health.riskLevel ?? 'medium'];
  const marketState = marketStatus(marketData.metadata);
  const isConfirmedPublicData = marketData.metadata.source.includes('public-data-fsc');
  const candlePoints = marketData.candles.map(candle => ({ date: candle.date, score: candle.close }));
  const firstCandle = marketData.candles[0];
  const lastCandle = marketData.candles.at(-1);
  const radarAreas = RADAR_KEYS.map(k => health.areas.find(a => a.key === k)).filter(
    (a): a is HealthArea => a != null,
  );
  const positiveEvents = events.filter(e => e.direction === 'positive').length;
  const negativeEvents = events.filter(e => e.direction === 'negative').length;

  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
      <StockHeader stock={quote} onBack={goBack} />

      <Panel style={styles.marketPanel}>
        <View style={styles.marketHead}>
          <Text style={[styles.marketTitle, { fontFamily: font('body', '700') }]}>일봉 시세 · Daily</Text>
          <StatusBadge label={marketState.label} tone={marketState.tone} size="sm" />
        </View>
        <Sparkline
          points={candlePoints}
          height={62}
          axisLeft={firstCandle?.date.slice(5).replace('-', '/')}
          axisRight={lastCandle?.date.slice(5).replace('-', '/')}
          style={styles.marketChart}
        />
        <View style={styles.marketStats}>
          <Text style={[styles.marketStat, { fontFamily: font('mono', '500') }]}>거래량 {quote.volume?.toLocaleString() ?? '—'}</Text>
          <Text style={[styles.marketStat, { fontFamily: font('mono', '500') }]}>거래대금 {quote.tradingValue ? `${Math.round(quote.tradingValue / 100_000_000).toLocaleString()}억원` : '—'}</Text>
        </View>
      </Panel>

      {/* 점수 스트립 — 기업 상태 / 논제 건강도 / 위험 수준 / AI 신뢰도 */}
      <View style={styles.strip}>
        <ScoreMetric
          variant="cell"
          label="기업 상태"
          value={String(health.total)}
          valueColor={colors.accent}
          sub={health.totalTrend ? `${health.totalTrend.delta >= 0 ? '▲' : '▼'} ${signed(health.totalTrend.delta)} (${health.totalTrend.period})` : undefined}
        />
        <View style={styles.stripDivider} />
        <ScoreMetric
          variant="cell"
          label="논제 건강도"
          value={thesis ? String(thesis.healthScore) : '없음'}
          valueColor={thesis ? colors.pos : colors.dim}
          textValue={!thesis}
          sub={
            thesis
              ? `${thesis.healthTrend.delta >= 0 ? '▲' : '▼'} ${signed(thesis.healthTrend.delta)}`
              : '작성 전'
          }
          subColor={thesis && thesis.healthTrend.delta < 0 ? colors.neg : colors.dim}
        />
        <View style={styles.stripDivider} />
        <ScoreMetric
          variant="cell"
          label="위험 수준"
          value={risk.label}
          valueColor={risk.color}
          textValue
          sub={health.riskNote}
        />
        <View style={styles.stripDivider} />
        <ScoreMetric
          variant="cell"
          label="AI 신뢰도"
          value={CONFIDENCE_TEXT[health.confidence.level]}
          valueColor={colors.accent}
          textValue
          sub="데이터 최신"
        />
      </View>

      {/* AI 기업 요약 + 상승/하락 요인 */}
      <Panel>
        {health.summary ? (
          <RichText
            text={health.summary}
            highlights={health.summaryHighlights}
            style={[styles.summary, { fontFamily: font('body', '500') }]}
          />
        ) : null}
        <View style={styles.split}>
          <View style={styles.splitCol}>
            <Text style={[styles.splitTitle, { color: colors.pos, fontFamily: font('body', '700') }]}>
              ▲ 주요 상승 요인
            </Text>
            <Text style={[styles.splitBody, { fontFamily: font('body', '500') }]}>
              {health.upsideDrivers.join(', ')}
            </Text>
          </View>
          <View style={styles.splitCol}>
            <Text style={[styles.splitTitle, { color: colors.neg, fontFamily: font('body', '700') }]}>
              ▼ 주요 하락 위험
            </Text>
            <Text style={[styles.splitBody, { fontFamily: font('body', '500') }]}>
              {health.downsideRisks.join(', ')}
            </Text>
          </View>
        </View>
      </Panel>

      {/* 기업 상태 분석 — 레이더 + 영역 바 */}
      <SectionHeader label="기업 상태 · Company Health" meta={`${radarAreas.length}개 영역`} />
      <View style={styles.healthRow}>
        <HealthRadarChart areas={radarAreas.map(a => ({ label: a.label, score: a.score }))} size={150} />
        <View style={styles.facets}>
          {radarAreas.map(a => (
            <FactorRow
              key={a.key}
              label={a.label}
              pct={a.score / 100}
              tone={scoreTone(a.score)}
              valueText={String(a.score)}
            />
          ))}
        </View>
      </View>
      {health.changeNote ? (
        <View style={styles.changeNote}>
          <Text style={[styles.changeNoteText, { fontFamily: font('body', '500') }]}>
            <Text style={{ color: colors.dim, fontFamily: font('mono', '500') }}>변화 원인 · </Text>
            {health.changeNote}
          </Text>
        </View>
      ) : null}

      {/* 미래 확률 분포 / 주요 이벤트 — 접기·펼치기 */}
      <FoldSection
        title="미래 확률 분포"
        summary={
          <Text style={[styles.foldSummary, { fontFamily: font('mono', '600') }]}>
            <Text style={{ color: colors.accent }}>
              초과수익 {Math.round(distribution.outperformProb * 100)}%
            </Text>
            {` · 낙폭 ${signed(Math.round(distribution.maxDrawdown * 100), '%')}`}
          </Text>
        }>
        <ProbabilityChart dist={distribution} style={styles.probChart} />
      </FoldSection>
      <FoldSection
        title="주요 이벤트"
        bottomLine
        summary={
          <Text style={[styles.foldSummary, { fontFamily: font('mono', '600') }]}>
            <Text style={{ color: colors.pos }}>긍정 {positiveEvents}</Text>
            {' · '}
            <Text style={{ color: colors.neg }}>부정 {negativeEvents}</Text>
          </Text>
        }>
        {events.length === 0 ? (
          <Text style={[styles.noEvents, { fontFamily: font('body', '500') }]}>
            최근 주요 이벤트가 없습니다.
          </Text>
        ) : (
          events.map((e, i) => <EventRow key={e.id} event={e} first={i === 0} showSource />)
        )}
      </FoldSection>

      {/* 기업 관계 네트워크 */}
      <SectionHeader label="기업 관계 지도 · Network" meta="딥러닝 그래프" />
      <NetworkGraph network={network} />

      {/* Management Track Record 진입 (프레임 15) */}
      <Pressable
        onPress={() =>
          router.push({ pathname: '/company/[symbol]/management', params: { symbol: quote.symbol } })
        }
        accessibilityRole="button"
        accessibilityLabel="경영진 발언–실적 이행 기록 보기"
        style={({ pressed }) => [styles.managementLink, { opacity: pressed ? 0.7 : 1 }]}>
        <View style={styles.managementText}>
          <Text style={[styles.managementTitle, { fontFamily: font('body', '700') }]}>
            Management Track Record
          </Text>
          <Text style={[styles.managementSub, { fontFamily: font('body', '500') }]}>
            경영진 발언–실적 이행 기록 · 이행률·가이던스 일관성
          </Text>
        </View>
        <Text style={[styles.managementArrow, { fontFamily: font('mono', '600') }]}>›</Text>
      </Pressable>

      {/* Scenario Lab / Thesis OS 진입 */}
      <View style={styles.cta}>
        <PrimaryButton
          label="Scenario Lab 열기"
          onPress={() => router.push({ pathname: '/scenario/[symbol]', params: { symbol: quote.symbol } })}
          style={styles.ctaMain}
        />
        <SecondaryButton
          label="투자 논제"
          onPress={() => router.push({ pathname: '/thesis/[symbol]', params: { symbol: quote.symbol } })}
          style={styles.ctaSub}
        />
      </View>

      <DataMetadata
        items={[
          `${isConfirmedPublicData ? '최근 확정 시세 기준일' : '시세 기준'} ${formatAsOf(marketData.metadata.asOf)}`,
          `시세 출처 ${marketData.metadata.source}`,
          ...(isConfirmedPublicData ? ['실시간 아님'] : []),
          marketState.label,
          `기업 분석 기준 ${formatAsOf(health.asOf)}`,
          `분석 신뢰도 ${Math.round(health.confidence.score * 100)}%`,
          '기업 분석 Mock 데이터 · 추정 범위',
        ]}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  marketPanel: { marginBottom: 14 },
  marketHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  marketTitle: { fontSize: 12, fontWeight: '700', color: colors.mut, textTransform: 'uppercase' },
  marketChart: { marginTop: 10 },
  marketStats: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 8 },
  marketStat: { fontSize: 10.5, color: colors.dim },
  strip: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
  },
  stripDivider: { width: 1, backgroundColor: colors.line },
  summary: { fontSize: 13.5, lineHeight: 21, color: '#b8c4da' },
  split: { flexDirection: 'row', gap: 14, marginTop: 13 },
  splitCol: { flex: 1 },
  splitTitle: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 7 },
  splitBody: { fontSize: 13, lineHeight: 20, color: '#b8c4da' },
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2, marginTop: 8 },
  facets: { flex: 1, gap: 2 },
  changeNote: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  changeNoteText: { fontSize: 13, lineHeight: 20, color: '#b8c4da' },
  foldSummary: { fontSize: 11.5, color: colors.dim, fontWeight: '600' },
  probChart: { marginTop: 4 },
  noEvents: { fontSize: 13, color: colors.mut, paddingVertical: 8 },
  cta: { flexDirection: 'row', gap: 10, marginTop: 16 },
  ctaMain: { flex: 1.2 },
  ctaSub: { flex: 1 },
  meta: { marginTop: 14 },
  managementLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 15,
    marginTop: 14,
    minHeight: 56,
  },
  managementText: { flex: 1 },
  managementTitle: { fontSize: 13.5, fontWeight: '700', color: colors.ink },
  managementSub: { fontSize: 11.5, color: colors.mut, marginTop: 3 },
  managementArrow: { fontSize: 18, color: colors.dim },
});
