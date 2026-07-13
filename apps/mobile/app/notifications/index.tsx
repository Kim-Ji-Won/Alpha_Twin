// Frame 09 — 알림 센터: 논제 충돌 우선.
// 오늘/어제 그룹 · 읽음 처리 · 유형별 딥링크 (Twin/Thesis/근거/Market Brain).
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { DataMetadata } from '@/components/DataMetadata';
import { NotificationCard } from '@/components/NotificationCard';
import { SectionHeader } from '@/components/SectionHeader';
import { StaticTabBar } from '@/components/StaticTabBar';
import { StatusBadge } from '@/components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { font } from '@/lib/fonts';
import { useAsync } from '@/lib/useAsync';
import { useSafeBack } from '@/lib/useSafeBack';
import { notificationService, stockService } from '@/src/services';
import { colors } from '@/src/theme';
import { AppNotification } from '@/src/types';

export default function NotificationsRoute() {
  const router = useRouter();
  const goBack = useSafeBack('/(tabs)/home');

  const { status, data, reload } = useAsync(
    async () => {
      const [notifications, stocks] = await Promise.all([
        notificationService.list(),
        stockService.getWatchlist(),
      ]);
      return { notifications, stocks };
    },
    [],
    { isEmpty: d => d.notifications.length === 0, reloadOnFocus: true },
  );

  const open = async (n: AppNotification) => {
    await notificationService.markRead(n.id);
    // 유형별 이동 (프레임 26 흐름): 충돌/강화/위험 → Thesis, 이벤트/데이터 → Twin, 국면 → Market Brain
    if ((n.kind === 'contradiction' || n.kind === 'reinforcement' || n.kind === 'risk') && n.symbol) {
      router.push({ pathname: '/thesis/[symbol]', params: { symbol: n.symbol } });
    } else if (n.symbol) {
      router.push({ pathname: '/company/[symbol]', params: { symbol: n.symbol } });
    } else {
      router.navigate('/(tabs)/home');
    }
    reload();
  };

  const header = (contradictions: number) => (
    <AppHeader
      onBack={goBack}
      subtitle="투자 논리와 충돌하는 정보 우선"
      title="알림"
      right={
        contradictions > 0 ? <StatusBadge label={`충돌 ${contradictions}건`} tone="warn" /> : undefined
      }
    />
  );

  if (status === 'loading') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="home" />}>
        {header(0)}
        <LoadingState stage="알림 불러오는 중" />
      </AppScreen>
    );
  }
  if (status === 'error' || !data) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="home" />}>
        {header(0)}
        <ErrorState onRetry={reload} />
      </AppScreen>
    );
  }
  if (status === 'empty') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="home" />}>
        {header(0)}
        <EmptyState
          title="알림이 없어요"
          message="논제와 충돌하는 정보, 근거 강화, 기업 이벤트가 생기면 여기로 알려드립니다."
          actionLabel="Market Brain으로"
          onAction={() => router.navigate('/(tabs)/home')}
        />
      </AppScreen>
    );
  }

  const { notifications, stocks } = data;
  const nameOf = (symbol?: string) => stocks.find(s => s.symbol === symbol)?.name;
  const contradictions = notifications.filter(n => n.kind === 'contradiction' && !n.read).length;
  const unread = notifications.filter(n => !n.read).length;

  // 날짜 그룹 — 최신 날짜를 '오늘', 그 전날을 '어제'로 (Mock 기준일)
  const dates = [...new Set(notifications.map(n => n.time.slice(0, 10)))].sort().reverse();
  const groupLabel = (date: string) =>
    date === dates[0] ? '오늘' : date === dates[1] ? '어제' : date.slice(5).replace('-', '/');

  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="home" />}>
      {header(contradictions)}

      {unread > 0 ? (
        <Pressable
          onPress={async () => {
            await notificationService.markAllRead();
            reload();
          }}
          accessibilityRole="button"
          accessibilityLabel="모든 알림 읽음 처리"
          style={({ pressed }) => [styles.markAll, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.markAllText, { fontFamily: font('body', '600') }]}>
            읽지 않음 {unread}건 · 전체 읽음 처리
          </Text>
        </Pressable>
      ) : null}

      {dates.map(date => (
        <React.Fragment key={date}>
          <SectionHeader label={groupLabel(date)} />
          {notifications
            .filter(n => n.time.startsWith(date))
            .map(n => (
              <NotificationCard
                key={n.id}
                notification={n}
                stockName={nameOf(n.symbol)}
                onPress={() => open(n)}
              />
            ))}
        </React.Fragment>
      ))}

      <DataMetadata
        items={['Mock 알림 · 실제 푸시 연동은 P3', '충돌 알림은 항상 우선 표시됩니다']}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  markAll: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 99,
    paddingVertical: 8,
    paddingHorizontal: 13,
    minHeight: 36,
    justifyContent: 'center',
  },
  markAllText: { fontSize: 12, color: colors.accent, fontWeight: '600' },
  meta: { marginTop: 8 },
});
