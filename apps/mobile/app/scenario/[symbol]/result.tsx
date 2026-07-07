// Frame 04 — Scenario Lab 결과: 전후 비교.
// ConclusionPanel(최상단 필수) + 전달 경로 + DeltaCompare + 영향 항목 + 관련 종목 + 포트폴리오 영향.
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { StaticTabBar } from '@/components/StaticTabBar';
import { AnalysisConfidence } from '@/components/AnalysisConfidence';
import { ConclusionPanel } from '@/components/ConclusionPanel';
import { DataMetadata, formatAsOf } from '@/components/DataMetadata';
import { FactorRow } from '@/components/FactorRow';
import { Panel } from '@/components/Panel';
import { SectionHeader } from '@/components/SectionHeader';
import { ErrorState, LoadingState } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';
import { TransmissionPath } from '@/components/TransmissionPath';
import { DeltaCompare } from '@/components/charts/DeltaCompare';
import { directionColor } from '@/lib/direction';
import { font } from '@/lib/fonts';
import { useAsync } from '@/lib/useAsync';
import { useSafeBack } from '@/lib/useSafeBack';
import { scenarioService } from '@/src/services';
import { colors } from '@/src/theme';

const CONFIDENCE_TEXT: Record<'high' | 'medium' | 'low', string> = {
  high: '높음',
  medium: '보통',
  low: '낮음',
};

export default function ScenarioResultRoute() {
  const router = useRouter();
  const { symbol, scenarioId } = useLocalSearchParams<{ symbol: string; scenarioId?: string }>();
  const goBack = useSafeBack({ pathname: '/company/[symbol]', params: { symbol: symbol ?? '' } });

  const { status, data, reload } = useAsync(
    async () => {
      // 입력 화면에서 파싱한 시나리오를 조회 — 딥링크 등 캐시가 없으면 기본 시나리오 생성
      let scenario = scenarioId ? scenarioService.getParsed(scenarioId) : undefined;
      if (!scenario) {
        scenario = await scenarioService.parse('', { symbol: symbol ?? undefined });
      }
      const result = await scenarioService.run(scenario.id);
      return { scenario, result };
    },
    [scenarioId, symbol],
    { isEmpty: () => false },
  );

  if (status === 'loading') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <LoadingState stage="ML 재무영향 · 관계전파 · 설명 결합 중" />
      </AppScreen>
    );
  }
  if (status !== 'success' || !data) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <ErrorState onRetry={reload} message="시나리오 분석에 실패했습니다." />
      </AppScreen>
    );
  }

  const { scenario, result } = data;

  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
      <AppHeader
        onBack={goBack}
        subtitle={`${symbol ?? result.symbol ?? ''} · 시나리오 결과`}
        title={scenario.title ?? '시나리오 결과'}
        right={scenario.badge ? <StatusBadge label={scenario.badge} tone="accent" /> : undefined}
      />

      <ConclusionPanel text={result.conclusion} />

      <Panel>
        <SectionHeader label="전달 경로 · Transmission" style={styles.panelHeader} />
        <TransmissionPath steps={result.transmissionPath} style={styles.path} />
        {result.transmissionNote ? (
          <Text style={[styles.note, { fontFamily: font('body', '500') }]}>
            {result.transmissionNote}
          </Text>
        ) : null}
      </Panel>

      <Panel>
        <SectionHeader label="시나리오 전후 비교 · Before → After" style={styles.panelHeader} />
        <DeltaCompare deltas={result.deltas} style={styles.deltas} />
      </Panel>

      {result.impacts && result.impacts.length > 0 ? (
        <Panel>
          <SectionHeader label="영향받는 재무 항목 · Impact" style={styles.panelHeader} />
          <View style={styles.impacts}>
            {result.impacts.map(item => (
              <FactorRow
                key={item.label}
                label={item.label}
                pct={item.pct}
                tone={directionColor(item.direction)}
                valueText={item.valueText}
                valueColor={directionColor(item.direction)}
                labelWidth={88}
              />
            ))}
          </View>
        </Panel>
      ) : null}

      <Panel variant="danger">
        <SectionHeader label="함께 영향받는 종목 · Related" style={styles.panelHeader} />
        <View style={styles.related}>
          {result.affectedCompanies.map(c => (
            <Pressable
              key={c.symbol}
              onPress={() =>
                router.push({ pathname: '/company/[symbol]', params: { symbol: c.symbol } })
              }
              accessibilityRole="button"
              accessibilityLabel={`${c.name}: ${c.impact}. 기업 트윈 열기`}
              style={({ pressed }) => [styles.relatedRow, { opacity: pressed ? 0.7 : 1 }]}>
              <View style={styles.relatedName}>
                <View style={[styles.dot, { backgroundColor: directionColor(c.direction) }]} />
                <Text style={[styles.relatedNameText, { fontFamily: font('body', '600') }]}>
                  {c.name}
                </Text>
              </View>
              <Text
                style={[
                  styles.relatedImpact,
                  { color: directionColor(c.direction), fontFamily: font('mono', '600') },
                ]}>
                {c.impact}
              </Text>
            </Pressable>
          ))}
        </View>
      </Panel>

      {result.portfolioImpact ? (
        <Panel>
          <SectionHeader label="포트폴리오 전체 영향 · X-Ray" style={styles.panelHeader} />
          <Text style={[styles.note, { fontFamily: font('body', '500') }]}>
            {result.portfolioImpact.summary}
          </Text>
          <AnalysisConfidence
            label={result.portfolioImpact.exposureLabel}
            pct={result.portfolioImpact.exposurePct}
            gradient={[colors.warn, colors.neg]}
            valueColor={colors.warn}
          />
        </Panel>
      ) : null}

      <DataMetadata
        items={[
          `데이터 기준 ${formatAsOf(result.asOf)}`,
          `분석 신뢰도 ${CONFIDENCE_TEXT[result.confidence.level]} ${Math.round(result.confidence.score * 100)}%`,
          '추정 범위이며 실제 결과를 보장하지 않습니다',
          'Mock · ML+딥러닝+LLM 결합 예정',
        ]}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  panelHeader: { marginTop: 0, marginBottom: 0 },
  path: { marginTop: 11 },
  note: { fontSize: 13, lineHeight: 20, color: '#b8c4da', marginTop: 11 },
  deltas: { marginTop: 6 },
  impacts: { marginTop: 10, gap: 4 },
  related: { marginTop: 9 },
  relatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    minHeight: 36,
  },
  relatedName: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 99 },
  relatedNameText: { fontSize: 13.5, color: '#cdd7e8', fontWeight: '600' },
  relatedImpact: { fontSize: 12, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  meta: { marginTop: 4 },
});
