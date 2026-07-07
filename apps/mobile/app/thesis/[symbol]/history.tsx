// Frame 22 — 논제 변경 기록: 건강도 Sparkline(이벤트 도트) + 버전 타임라인.
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { StaticTabBar } from '@/components/StaticTabBar';
import { DataMetadata } from '@/components/DataMetadata';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';
import { VersionTimeline, changeDotColor } from '@/components/VersionTimeline';
import { Sparkline, SparklineMarker } from '@/components/charts/Sparkline';
import { useQuote, useThesis } from '@/lib/hooks';
import { useSafeBack } from '@/lib/useSafeBack';

export default function ThesisHistoryRoute() {
  const router = useRouter();
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const { status, data: thesis, reload } = useThesis(symbol ?? '');
  const { data: quote } = useQuote(symbol ?? '');

  const subtitle = quote ? `${quote.name} · Thesis OS` : (symbol ?? '');
  const goBack = useSafeBack({ pathname: '/thesis/[symbol]', params: { symbol: symbol ?? '' } });

  if (status === 'loading') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <LoadingState stage="변경 기록 불러오는 중" />
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
        <AppHeader onBack={goBack} subtitle={subtitle} title="변경 기록" />
        <EmptyState
          title="변경 기록이 없어요"
          message="논제를 작성하면 건강도 변화와 수정 이력이 여기에 기록됩니다."
          actionLabel="논제 작성하기"
          onAction={() =>
            router.push({ pathname: '/thesis/[symbol]/edit', params: { symbol: symbol ?? '' } })
          }
        />
      </AppScreen>
    );
  }

  // 변경 이벤트를 건강도 추이 위 도트로 — 날짜가 일치하는 지점에 변화 색 표시
  const markers: SparklineMarker[] = thesis.changes
    .map(c => ({
      index: thesis.healthHistory.findIndex(p => p.date === c.date),
      color: changeDotColor(c),
    }))
    .filter(m => m.index >= 0);

  const firstMonth = thesis.healthHistory[0]
    ? `${parseInt(thesis.healthHistory[0].date.slice(5, 7), 10)}월`
    : undefined;
  const todayDate = new Date().toISOString().slice(0, 10);
  const latestScore = thesis.healthHistory[thesis.healthHistory.length - 1];

  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
      <AppHeader
        onBack={goBack}
        subtitle={subtitle}
        title="변경 기록"
        right={<StatusBadge label={`v1 → v${thesis.version}`} tone="neutral" />}
      />

      <Sparkline
        points={thesis.healthHistory}
        height={64}
        markers={markers}
        axisLeft={firstMonth}
        axisRight="오늘"
        style={styles.sparkline}
      />

      <VersionTimeline changes={thesis.changes} today={todayDate} />

      <DataMetadata
        items={[
          `v${thesis.version} · 변경 ${thesis.changes.length}건`,
          latestScore ? `현재 건강도 ${latestScore.score}` : '',
          '도트: 시안=생성 · 앰버=사용자 수정 · 민트/레드=자동 변화',
        ].filter(Boolean)}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  sparkline: { marginBottom: 18, paddingHorizontal: 2 },
  meta: { marginTop: 20 },
});
