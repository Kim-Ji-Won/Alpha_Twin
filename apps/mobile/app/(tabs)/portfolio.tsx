// Frame 06 — Portfolio X-Ray: 숨은 공통 위험.
// 위험 히어로 + 위험 요인 노출 + 중첩 지도 + 통계 3 + 산업별 비중 + AI 제안.
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { DataMetadata, formatAsOf } from '@/components/DataMetadata';
import { FactorRow } from '@/components/FactorRow';
import { HeroCard } from '@/components/HeroCard';
import { Panel } from '@/components/Panel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScoreMetric } from '@/components/ScoreMetric';
import { SecondaryButton } from '@/components/SecondaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { AllocationBar } from '@/components/charts/AllocationBar';
import { RichText } from '@/components/RichText';
import { RiskOverlapGraph } from '@/components/charts/RiskOverlapGraph';
import { font } from '@/lib/fonts';
import { formatManwon } from '@/lib/format';
import { usePortfolioXray } from '@/lib/hooks';
import { colors } from '@/src/theme';

function ManageIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 16 16">
      <Path
        d="M2 13.5h12M4 10.5v3M8 6.5v7M12 3v10.5"
        stroke={colors.mut}
        strokeWidth={1.5}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

export default function PortfolioTab() {
  const router = useRouter();
  const { status, data, reload } = usePortfolioXray();

  const goHoldings = () => router.push('/portfolio/holdings');
  const goAdd = () => router.push('/portfolio/add');

  const header = (
    <AppHeader
      subtitle={
        data && data.portfolio.holdings.length > 0
          ? `포트폴리오 · 평가액 ${formatManwon(data.portfolio.totalValue)}`
          : '포트폴리오'
      }
      title="Portfolio X-Ray"
      right={
        <Pressable
          onPress={goHoldings}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="보유 종목 관리"
          style={styles.headerBtn}>
          <ManageIcon />
        </Pressable>
      }
    />
  );

  if (status === 'loading') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']}>
        {header}
        <LoadingState stage="포트폴리오 위험 분석 중" />
      </AppScreen>
    );
  }
  if (status === 'error' || !data) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']}>
        {header}
        <ErrorState onRetry={reload} />
      </AppScreen>
    );
  }
  if (status === 'empty') {
    // 프레임 17 — 빈 포트폴리오 상태
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']}>
        {header}
        <EmptyState
          title="빈 포트폴리오"
          message="보유 종목을 추가하면 X-Ray가 숨은 공통 위험을 분석합니다."
          actionLabel="종목 추가하기"
          onAction={goAdd}
        />
      </AppScreen>
    );
  }

  const { portfolio, risk } = data;
  const headlineParts = risk.headline.split('지만');
  const topHolding = portfolio.holdings[0];

  return (
    <AppScreen edges={['top', 'left', 'right']}>
      {header}

      <HeroCard tag="숨겨진 공통 위험 · HIDDEN RISK" tone="warn">
        <Text style={[styles.headline, { fontFamily: font('body', '800') }]}>
          {headlineParts.length === 2 ? `${headlineParts[0]}지만\n${headlineParts[1].trim()}` : risk.headline}
        </Text>
        <Text style={[styles.heroBody, { fontFamily: font('body', '500') }]}>
          서로 다른 산업처럼 보이지만 대부분 미국 AI 설비투자 사이클 하나에 의존하고 있습니다.
        </Text>
      </HeroCard>

      <Panel>
        <SectionHeader label="위험 요인 노출 · Risk Factors" style={styles.panelHeader} />
        <View style={styles.factors}>
          {risk.factors.map(f => (
            <FactorRow
              key={f.label}
              label={f.label}
              pct={f.exposure}
              tone={f.severity === 'high' ? colors.warn : colors.accent}
              valueText={`${Math.round(f.exposure * 100)}%`}
              valueColor={f.severity === 'high' ? colors.warn : colors.mut}
              labelWidth={118}
            />
          ))}
        </View>
      </Panel>

      <Panel>
        <SectionHeader label="위험 중첩 지도 · Overlap" meta="종목 → 위험 요인" style={styles.panelHeader} />
        <RiskOverlapGraph
          stocks={portfolio.holdings.map(h => ({ symbol: h.symbol, name: h.name }))}
          factors={risk.factors}
          style={styles.overlap}
        />
      </Panel>

      <View style={styles.g3}>
        <ScoreMetric
          label="집중도"
          value={risk.concentrationHHI >= 0.25 ? '높음' : '보통'}
          valueColor={risk.concentrationHHI >= 0.25 ? colors.warn : colors.accent}
          textValue
          sub={`HHI ${risk.concentrationHHI.toFixed(2)}`}
        />
        <ScoreMetric
          label="급락 시 낙폭"
          value={`${Math.round(risk.var95 * 100)}%`}
          valueColor={colors.neg}
          sub="95% VaR"
        />
        <ScoreMetric
          label="평균 상관"
          value={risk.avgCorrelation.toFixed(2)}
          valueColor={colors.ink}
          sub={risk.avgCorrelation >= 0.6 ? '◆ 높음' : '보통'}
          subColor={risk.avgCorrelation >= 0.6 ? colors.warn : colors.mut}
        />
      </View>

      <Panel>
        <SectionHeader label="산업별 비중 · Allocation" style={styles.panelHeader} />
        <AllocationBar items={risk.allocation} />
      </Panel>

      <Panel variant="alert">
        <SectionHeader label="AI 제안 · Suggestion" style={styles.panelHeader} />
        <RichText
          text={risk.suggestion}
          highlights={risk.suggestionHighlights}
          style={[styles.suggestion, { fontFamily: font('body', '500') }]}
        />
      </Panel>

      <View style={styles.cta}>
        <PrimaryButton
          label="Scenario Lab 열기"
          onPress={() =>
            router.push({
              pathname: '/scenario/[symbol]',
              params: { symbol: topHolding?.symbol ?? '000660' },
            })
          }
          style={styles.ctaMain}
        />
        <SecondaryButton label="종목 관리" onPress={goHoldings} style={styles.ctaSub} />
      </View>

      <DataMetadata
        items={[
          `데이터 기준 ${formatAsOf(risk.asOf)}`,
          `보유 ${portfolio.holdings.length}종목 · 조회 전용`,
          'Mock 데이터 · 추정 범위',
        ]}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: { marginTop: 8, fontSize: 21, lineHeight: 29, fontWeight: '800', letterSpacing: -0.4, color: colors.ink },
  heroBody: { fontSize: 14, lineHeight: 22, color: '#b8c4da', marginTop: 8 },
  panelHeader: { marginTop: 0, marginBottom: 0 },
  factors: { marginTop: 10, gap: 5 },
  overlap: { marginTop: 10 },
  g3: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  suggestion: { fontSize: 13.5, lineHeight: 21, color: '#b8c4da', marginTop: 9 },
  cta: { flexDirection: 'row', gap: 10, marginTop: 2 },
  ctaMain: { flex: 1.2 },
  ctaSub: { flex: 1 },
  meta: { marginTop: 14 },
});
