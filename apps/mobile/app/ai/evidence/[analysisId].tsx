// Frame 23 — AI 분석 근거 상세: 출처·모델 투명성.
// BASIS(기준일/신뢰도/모델/미확인) + 원문 출처 + 모델 기여도 + 관련 화면 이동.
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { DataMetadata, formatAsOf } from '@/components/DataMetadata';
import { FactorRow } from '@/components/FactorRow';
import { MetricItem } from '@/components/MetricItem';
import { Panel } from '@/components/Panel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SecondaryButton } from '@/components/SecondaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { SourceCard } from '@/components/SourceCard';
import { StaticTabBar } from '@/components/StaticTabBar';
import { ErrorState, LoadingState } from '@/components/States';
import { font } from '@/lib/fonts';
import { useAnalysis } from '@/lib/hooks';
import { useSafeBack } from '@/lib/useSafeBack';
import { chartColors, colors } from '@/src/theme';

const CONFIDENCE_TEXT: Record<'high' | 'medium' | 'low', string> = {
  high: '높음',
  medium: '보통',
  low: '낮음',
};

export default function EvidenceRoute() {
  const router = useRouter();
  const { analysisId } = useLocalSearchParams<{ analysisId: string }>();
  const goBack = useSafeBack('/(tabs)/ai');
  const { status, data: analysis, reload } = useAnalysis(analysisId ?? '');

  if (status === 'loading') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="ai" />}>
        <LoadingState stage="근거·출처 불러오는 중" />
      </AppScreen>
    );
  }
  if (status !== 'success' || !analysis) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="ai" />}>
        <ErrorState onRetry={reload} />
      </AppScreen>
    );
  }

  const ev = analysis.evidence;
  const symbol = analysis.symbol ?? '000660';
  const attributionPalette = [colors.accent, colors.accent2, colors.violet, colors.neutral];

  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="ai" />}>
      <AppHeader onBack={goBack} subtitle="AI Analyst · 답변 근거" title="근거 및 출처" />

      {/* 분석 대상 질문·결론 */}
      <Panel>
        <SectionHeader label="이 답변의 데이터 · Basis" style={styles.panelHeader} />
        <Text style={[styles.question, { fontFamily: font('body', '600') }]}>
          Q. {analysis.question}
        </Text>
        <Text style={[styles.conclusion, { fontFamily: font('body', '700') }]}>
          {analysis.conclusion}
        </Text>
        <View style={styles.kvList}>
          <MetricItem first label="데이터 기준일" value={formatAsOf(ev.asOf)} />
          <MetricItem
            label="분석 신뢰도"
            value={`${CONFIDENCE_TEXT[ev.confidence.level]} · ${ev.confidence.score.toFixed(2)}`}
            direction={ev.confidence.level === 'high' ? 'positive' : 'mixed'}
          />
          <MetricItem label="사용 모델" value="ML 확률 + DL 이벤트 + LLM 설명" />
          {ev.unverifiedAreas.map(area => (
            <MetricItem key={area} label="미확인 영역" value={area} direction="mixed" />
          ))}
        </View>
      </Panel>

      <SectionHeader label={`원문 출처 ${ev.sources.length}건 · Sources`} />
      {ev.sources.map(source => (
        <SourceCard
          key={source.id}
          source={source}
          onOpenManagement={
            source.kind === 'transcript'
              ? () =>
                  router.push({ pathname: '/company/[symbol]/management', params: { symbol } })
              : undefined
          }
        />
      ))}

      <Panel style={styles.attribution}>
        <SectionHeader label="모델 기여도 · Attribution" style={styles.panelHeader} />
        <View style={styles.factors}>
          {ev.modelAttribution.map((m, i) => (
            <FactorRow
              key={m.label}
              label={m.label}
              pct={m.weight}
              tone={attributionPalette[i % attributionPalette.length]}
              valueText={`${Math.round(m.weight * 100)}%`}
              labelWidth={110}
            />
          ))}
        </View>
        <Text style={[styles.attributionNote, { fontFamily: font('mono', '500') }]}>
          LLM은 수치를 생성하지 않으며, 위 분석 결과를 설명하는 역할만 합니다.
        </Text>
      </Panel>

      <View style={styles.cta}>
        <PrimaryButton
          label="관련 Company Twin"
          onPress={() => router.push({ pathname: '/company/[symbol]', params: { symbol } })}
          style={styles.ctaMain}
        />
        <SecondaryButton
          label="Thesis OS"
          onPress={() => router.push({ pathname: '/thesis/[symbol]', params: { symbol } })}
          style={styles.ctaSub}
        />
      </View>

      <DataMetadata
        items={[`데이터 기준 ${formatAsOf(ev.asOf)}`, 'Mock 출처 · 실제 원문 연결은 P3']}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  panelHeader: { marginTop: 0, marginBottom: 0 },
  question: { fontSize: 12.5, lineHeight: 19, color: colors.mut, marginTop: 9 },
  conclusion: { fontSize: 13.5, lineHeight: 20, color: colors.ink, fontWeight: '700', marginTop: 6 },
  kvList: { marginTop: 8 },
  attribution: { marginTop: 14 },
  factors: { marginTop: 10, gap: 5 },
  attributionNote: { fontSize: 11, lineHeight: 18, color: colors.dim, marginTop: 10 },
  cta: { flexDirection: 'row', gap: 10, marginTop: 2 },
  ctaMain: { flex: 1.2 },
  ctaSub: { flex: 1 },
  meta: { marginTop: 14 },
});
