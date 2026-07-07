// Frame 05 — Thesis OS: 투자 논제 감시.
// 건강도 히어로(Sparkline+근거 칩) + 원문 인용 + 가설 + 지표 + KillCriteria.
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { StaticTabBar } from '@/components/StaticTabBar';
import { CheckItem } from '@/components/CheckItem';
import { DataMetadata } from '@/components/DataMetadata';
import { EvidenceCountChip } from '@/components/EvidenceCountChip';
import { HeroCard } from '@/components/HeroCard';
import { MetricItem } from '@/components/MetricItem';
import { Panel } from '@/components/Panel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SecondaryButton } from '@/components/SecondaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';
import { Sparkline } from '@/components/charts/Sparkline';
import { signed } from '@/lib/direction';
import { font } from '@/lib/fonts';
import { useQuote, useThesis } from '@/lib/hooks';
import { useSafeBack } from '@/lib/useSafeBack';
import { colors } from '@/src/theme';
import { KillCriterion } from '@/src/types';

const KILL_STATUS: Record<KillCriterion['status'], { label: string; color: string; dot: string }> = {
  safe: { label: '감시 중', color: colors.dim, dot: 'rgba(255,255,255,0.25)' },
  approaching: { label: '근접', color: colors.warn, dot: colors.warn },
  triggered: { label: '발동', color: colors.neg, dot: colors.neg },
};

export default function ThesisRoute() {
  const router = useRouter();
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const { status, data: thesis, reload } = useThesis(symbol ?? '');
  const { data: quote } = useQuote(symbol ?? '');

  const subtitle = quote ? `${quote.name} · ${quote.symbol}` : (symbol ?? '');
  const goBack = useSafeBack({ pathname: '/company/[symbol]', params: { symbol: symbol ?? '' } });
  const goEdit = () =>
    router.push({ pathname: '/thesis/[symbol]/edit', params: { symbol: symbol ?? '' } });

  if (status === 'loading') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <LoadingState stage="투자 논제 불러오는 중" />
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
  if (status === 'empty' || !thesis) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <AppHeader onBack={goBack} subtitle={subtitle} title="투자 논제" />
        <EmptyState
          title="아직 작성한 논제가 없어요"
          message="이 종목을 왜 샀는지 한 문장으로 적으면, AI가 검증 가능한 가설로 구조화하고 새로운 뉴스·실적이 나올 때마다 유효한지 확인합니다."
          actionLabel="논제 작성하기"
          onAction={goEdit}
        />
      </AppScreen>
    );
  }

  const trendUp = thesis.healthTrend.delta >= 0;
  const latestAuto = thesis.changes.find(c => c.kind === 'auto');

  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
      <AppHeader
        onBack={goBack}
        subtitle={subtitle}
        title="투자 논제"
        right={<StatusBadge label={`${thesis.createdAt.replaceAll('-', '.')} 작성`} tone="neutral" />}
      />

      <HeroCard tag="논제 건강도 · THESIS HEALTH">
        <View style={styles.scoreRow}>
          <Text
            style={[styles.score, { fontFamily: font('mono', '800') }]}
            accessibilityLabel={`논제 건강도 ${thesis.healthScore}점, 전일 대비 ${Math.abs(thesis.healthTrend.delta)} ${trendUp ? '상승' : '하락'}`}>
            {thesis.healthScore}
          </Text>
          <View style={styles.scoreMeta}>
            <Text
              style={[
                styles.trend,
                { color: trendUp ? colors.pos : colors.neg, fontFamily: font('mono', '700') },
              ]}>
              {trendUp ? '▲' : '▼'} {signed(thesis.healthTrend.delta)} 전일 대비
            </Text>
            {latestAuto ? (
              <Text style={[styles.trendNote, { fontFamily: font('mono', '500') }]} numberOfLines={1}>
                {latestAuto.reason.split('—')[0].trim()}
              </Text>
            ) : null}
          </View>
        </View>
        <Sparkline
          points={thesis.healthHistory}
          height={54}
          axisLeft={thesis.healthHistory[0] ? `${parseInt(thesis.healthHistory[0].date.slice(5, 7), 10)}월` : undefined}
          axisRight="오늘"
          style={styles.sparkline}
        />
        <View style={styles.chips}>
          <EvidenceCountChip label="긍정 근거" count={thesis.evidence.positive} tone="pos" />
          <EvidenceCountChip label="부정 근거" count={thesis.evidence.negative} tone="neg" />
          <EvidenceCountChip label="미확인" count={thesis.evidence.unverified} tone="neutral" />
        </View>
      </HeroCard>

      <Panel>
        <SectionHeader label="내가 작성한 논리 · My Thesis" style={styles.panelHeader} />
        <Text style={[styles.rawText, { fontFamily: font('body', '500') }]}>
          "{thesis.rawText}"
        </Text>
        <Text style={[styles.structNote, { fontFamily: font('mono', '500') }]}>
          AI가 {thesis.hypotheses.length}개 가설 · {thesis.signals.length}개 지표 ·{' '}
          {thesis.killCriteria.length}개 실패 조건으로 구조화
        </Text>
      </Panel>

      <Panel>
        <SectionHeader label="핵심 투자 가설 · Hypotheses" style={styles.panelHeader} />
        <View style={styles.list}>
          {thesis.hypotheses.map((h, i) => (
            <CheckItem
              key={h.id}
              status={h.status}
              title={h.text}
              note={h.evidenceNote || undefined}
              first={i === 0}
            />
          ))}
        </View>
      </Panel>

      <Panel>
        <SectionHeader label="확인 지표 · Signals" meta="자동 추적 중" style={styles.panelHeader} />
        <View style={styles.list}>
          {thesis.signals.map((s, i) => (
            <MetricItem key={s.label} label={s.label} value={s.value} direction={s.direction} first={i === 0} />
          ))}
        </View>
      </Panel>

      {/* 실패 조건 — 명확한 경고 영역 */}
      <Panel variant="danger">
        <SectionHeader label="논제 실패 조건 · Kill Criteria" style={styles.panelHeader} />
        <View style={styles.list}>
          {thesis.killCriteria.map(k => {
            const s = KILL_STATUS[k.status];
            return (
              <View
                key={k.text}
                style={styles.killRow}
                accessibilityLabel={`실패 조건: ${k.text}, 상태 ${s.label}`}>
                <View style={styles.killName}>
                  <View style={[styles.dot, { backgroundColor: s.dot }]} />
                  <Text style={[styles.killText, { fontFamily: font('body', '600') }]}>{k.text}</Text>
                </View>
                <Text style={[styles.killStatus, { color: s.color, fontFamily: font('mono', '600') }]}>
                  {s.label}
                </Text>
              </View>
            );
          })}
        </View>
      </Panel>

      <View style={styles.cta}>
        <PrimaryButton label="논제 업데이트" onPress={goEdit} style={styles.ctaMain} />
        <SecondaryButton
          label="변경 기록"
          onPress={() =>
            router.push({ pathname: '/thesis/[symbol]/history', params: { symbol: symbol ?? '' } })
          }
          style={styles.ctaSub}
        />
      </View>

      <DataMetadata
        items={[`v${thesis.version}`, `작성 ${thesis.createdAt}`, '건강도는 근거 기반 계산값입니다']}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  scoreRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: 8 },
  score: { fontSize: 44, lineHeight: 46, fontWeight: '800', letterSpacing: -2, color: colors.ink },
  scoreMeta: { paddingBottom: 6, flexShrink: 1 },
  trend: { fontSize: 13, fontWeight: '700' },
  trendNote: { fontSize: 10, color: colors.dim, marginTop: 3 },
  sparkline: { marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  panelHeader: { marginTop: 0, marginBottom: 0 },
  rawText: { fontSize: 14, lineHeight: 22, color: '#b8c4da', marginTop: 9 },
  structNote: { fontSize: 11, color: colors.dim, marginTop: 9 },
  list: { marginTop: 6 },
  killRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    minHeight: 36,
  },
  killName: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 99 },
  killText: { fontSize: 13.5, color: '#cdd7e8', fontWeight: '600' },
  killStatus: { fontSize: 12, fontWeight: '600' },
  cta: { flexDirection: 'row', gap: 10, marginTop: 16 },
  ctaMain: { flex: 1.2 },
  ctaSub: { flex: 1 },
  meta: { marginTop: 14 },
});
