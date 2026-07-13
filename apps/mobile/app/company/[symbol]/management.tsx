// Frame 15 — Management Track Record: 경영진 발언–실적 이행 기록.
// 평가·비난이 아닌 사실 기반 기록 (이행률·달성 기록·표현 변화·가이던스 일관성).
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AnalysisConfidence } from '@/components/AnalysisConfidence';
import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { ChartLegend } from '@/components/ChartLegend';
import { DataMetadata, formatAsOf } from '@/components/DataMetadata';
import { FactorRow } from '@/components/FactorRow';
import { HeroCard } from '@/components/HeroCard';
import { Panel } from '@/components/Panel';
import { ScoreMetric } from '@/components/ScoreMetric';
import { SectionHeader } from '@/components/SectionHeader';
import { ErrorState, LoadingState } from '@/components/States';
import { StaticTabBar } from '@/components/StaticTabBar';
import { TrackRecordRow } from '@/components/TrackRecordRow';
import { signed } from '@/lib/direction';
import { font } from '@/lib/fonts';
import { useManagement, useQuote } from '@/lib/hooks';
import { useSafeBack } from '@/lib/useSafeBack';
import { colors } from '@/src/theme';

export default function ManagementRoute() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const goBack = useSafeBack({ pathname: '/company/[symbol]', params: { symbol: symbol ?? '' } });
  const { status, data: record, reload } = useManagement(symbol ?? '');
  const { data: quote } = useQuote(symbol ?? '');

  if (status === 'loading') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <LoadingState stage="발언–실적 기록 불러오는 중" />
      </AppScreen>
    );
  }
  if (status !== 'success' || !record) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <ErrorState onRetry={reload} />
      </AppScreen>
    );
  }

  const counts =
    record.statusCounts ?? {
      achieved: record.commitments.filter(c => c.status === 'achieved').length,
      delayed: record.commitments.filter(c => c.status === 'delayed').length,
      withdrawn: record.commitments.filter(c => c.status === 'withdrawn').length,
    };
  const shift = record.languageShift;
  const shiftSummary = `직전 콜 대비 확정적 표현 비중이 ${Math.abs(shift.assertive)}%p ${shift.assertive < 0 ? '감소' : '증가'}하고 조건부 표현이 ${shift.conditional > 0 ? '늘었습니다' : '줄었습니다'}.`;

  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
      <AppHeader
        onBack={goBack}
        subtitle={`${quote?.name ?? symbol} · 경영진 발언–실적 이행 기록`}
        title="Management Track Record"
      />

      <HeroCard tag="약속 이행률 · TRACK RECORD">
        <View style={styles.scoreRow}>
          <Text
            style={[styles.score, { fontFamily: font('mono', '800') }]}
            accessibilityLabel={`약속 이행률 ${Math.round(record.fulfillmentRate * 100)}퍼센트`}>
            {Math.round(record.fulfillmentRate * 100)}
            <Text style={styles.scoreUnit}>%</Text>
          </Text>
          <View style={styles.scoreMeta}>
            <Text style={[styles.metaMain, { fontFamily: font('mono', '700') }]}>
              최근 {record.quarters}개 분기 · 공약 {record.goalsTracked ?? record.commitments.length}건
            </Text>
            <Text style={[styles.metaSub, { fontFamily: font('mono', '500') }]}>
              동종업계 평균 {Math.round(record.peerAverage * 100)}%
            </Text>
          </View>
        </View>
        <AnalysisConfidence label="" pct={record.fulfillmentRate} valueText=" " />
        <ChartLegend
          items={[
            { color: colors.pos, label: `달성 ${counts.achieved}` },
            { color: colors.warn, label: `지연 ${counts.delayed}` },
            { color: colors.neg, label: `철회 ${counts.withdrawn}` },
          ]}
        />
      </HeroCard>

      <Panel>
        <SectionHeader label="목표 달성 기록 · Track Record" style={styles.panelHeader} />
        <View style={styles.records}>
          {record.commitments.map((c, i) => (
            <TrackRecordRow key={c.text} commitment={c} first={i === 0} />
          ))}
        </View>
      </Panel>

      <Panel>
        <SectionHeader label="발언–실적 일치도 · Consistency" meta="딥러닝 텍스트" style={styles.panelHeader} />
        <Text style={[styles.body, { fontFamily: font('body', '500') }]}>
          {shiftSummary} {shift.note}
        </Text>
        <View style={styles.g2}>
          <ScoreMetric
            label="확정적 표현"
            value={signed(shift.assertive, '%p')}
            valueColor={shift.assertive < 0 ? colors.neg : colors.pos}
            sub="QoQ"
          />
          <ScoreMetric
            label="조건부 표현"
            value={signed(shift.conditional, '%p')}
            valueColor={colors.warn}
            sub="QoQ"
          />
        </View>
      </Panel>

      <Panel>
        <SectionHeader label="가이던스 일관성 · Guidance" style={styles.panelHeader} />
        <View style={styles.factors}>
          {record.guidanceConsistency.map(g => (
            <FactorRow
              key={g.label}
              label={g.label}
              pct={g.rate}
              tone={g.rate >= 0.75 ? colors.pos : colors.warn}
              valueText={`${Math.round(g.rate * 100)}%`}
              valueColor={g.rate >= 0.75 ? colors.pos : colors.warn}
              labelWidth={96}
            />
          ))}
        </View>
        <Text style={[styles.foot, { fontFamily: font('mono', '500') }]}>
          과거 {record.quarters}개 분기 가이던스 대비 실제 달성률 · 평가가 아닌 일관성 분석
        </Text>
      </Panel>

      <DataMetadata
        items={[
          record.asOf ? `데이터 기준 ${formatAsOf(record.asOf)}` : '데이터 기준일 미상',
          `분석 범위: 최근 ${record.quarters}개 분기 공개 발언·공시`,
          '발언–실적 일치 기록이며 경영진 평가가 아닙니다',
        ]}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: 8 },
  score: { fontSize: 44, lineHeight: 46, fontWeight: '800', letterSpacing: -2, color: colors.ink },
  scoreUnit: { fontSize: 20, color: colors.mut, letterSpacing: 0 },
  scoreMeta: { paddingBottom: 6 },
  metaMain: { fontSize: 12, fontWeight: '700', color: colors.mut },
  metaSub: { fontSize: 10, color: colors.dim, marginTop: 3 },
  panelHeader: { marginTop: 0, marginBottom: 0 },
  records: { marginTop: 4 },
  body: { fontSize: 13.5, lineHeight: 21, color: '#b8c4da', marginTop: 9 },
  g2: { flexDirection: 'row', gap: 10, marginTop: 12 },
  factors: { marginTop: 10, gap: 5 },
  foot: { fontSize: 11, lineHeight: 18, color: colors.dim, marginTop: 10 },
  meta: { marginTop: 4 },
});
