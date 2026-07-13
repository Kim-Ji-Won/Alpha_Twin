// P2 — 보유 종목 관리: 목록 · 검색 · 추가/수정 진입 · 길게 눌러 삭제.
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { DataMetadata } from '@/components/DataMetadata';
import { HoldingRow } from '@/components/HoldingRow';
import { StaticTabBar } from '@/components/StaticTabBar';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { font } from '@/lib/fonts';
import { formatManwon } from '@/lib/format';
import { useSafeBack } from '@/lib/useSafeBack';
import { useAsync } from '@/lib/useAsync';
import { portfolioService, stockService } from '@/src/services';
import { colors } from '@/src/theme';
import { PortfolioHolding } from '@/src/types';

export default function HoldingsRoute() {
  const router = useRouter();
  const goBack = useSafeBack('/(tabs)/portfolio');
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<PortfolioHolding | null>(null);

  const { status, data, reload } = useAsync(
    async () => {
      const [portfolio, stocks] = await Promise.all([
        portfolioService.get(),
        stockService.getWatchlist(),
      ]);
      return { portfolio, stocks };
    },
    [],
    { isEmpty: d => d.portfolio.holdings.length === 0, reloadOnFocus: true },
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim();
    if (!q) return data.portfolio.holdings;
    return data.portfolio.holdings.filter(h => h.name.includes(q) || h.symbol.includes(q));
  }, [data, query]);

  const header = (
    <AppHeader
      onBack={goBack}
      subtitle="Portfolio"
      title="보유 종목"
      right={
        <Pressable
          onPress={() => router.push('/portfolio/add')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="보유 종목 추가"
          style={styles.addBtn}>
          <Svg width={15} height={15} viewBox="0 0 16 16">
            <Path d="M8 3v10M3 8h10" stroke={colors.mut} strokeWidth={1.5} strokeLinecap="round" />
          </Svg>
        </Pressable>
      }
    />
  );

  if (status === 'loading') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="portfolio" />}>
        {header}
        <LoadingState stage="보유 내역 불러오는 중" />
      </AppScreen>
    );
  }
  if (status === 'error' || !data) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="portfolio" />}>
        {header}
        <ErrorState onRetry={reload} />
      </AppScreen>
    );
  }
  if (status === 'empty') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="portfolio" />}>
        {header}
        <EmptyState
          title="빈 포트폴리오"
          message="보유 종목을 추가하면 X-Ray가 숨은 공통 위험을 분석합니다."
          actionLabel="종목 추가하기"
          onAction={() => router.push('/portfolio/add')}
        />
      </AppScreen>
    );
  }

  const stockOf = (symbol: string) => data.stocks.find(s => s.symbol === symbol);

  return (
    <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="portfolio" />}>
      {header}
      <View style={styles.search}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="보유 종목 검색"
          placeholderTextColor={colors.dim}
          accessibilityLabel="보유 종목 검색"
          style={[styles.searchInput, { fontFamily: font('body', '500') }]}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={h => h.symbol}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={[styles.noResult, { fontFamily: font('body', '500') }]}>
            '{query}'와 일치하는 보유 종목이 없습니다.
          </Text>
        }
        ListFooterComponent={
          <DataMetadata
            items={[
              `평가액 ${formatManwon(data.portfolio.totalValue)} · ${data.portfolio.holdings.length}종목`,
              '길게 누르면 삭제 · 잔고·매매 기능이 없는 분석 전용 기록',
            ]}
            style={styles.meta}
          />
        }
        renderItem={({ item, index }) => (
          <Pressable
            onLongPress={() => setPendingDelete(item)}
            accessibilityLabel={`${item.name} 길게 눌러 삭제`}>
            <HoldingRow
              holding={item}
              currentPrice={stockOf(item.symbol)?.price}
              sector={stockOf(item.symbol)?.sector}
              first={index === 0}
              onPress={() =>
                router.push({ pathname: '/portfolio/edit/[symbol]', params: { symbol: item.symbol } })
              }
            />
          </Pressable>
        )}
      />
      <ConfirmationModal
        visible={pendingDelete != null}
        title="보유 종목 삭제"
        message={
          pendingDelete
            ? `${pendingDelete.name}(${pendingDelete.symbol})을(를) 포트폴리오에서 삭제할까요? 기록만 삭제되며 실제 계좌에는 영향이 없습니다.`
            : ''
        }
        confirmLabel="삭제"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) {
            await portfolioService.removeHolding(pendingDelete.symbol);
            setPendingDelete(null);
            reload();
          }
        }}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: { marginBottom: 6 },
  searchInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 13.5,
    color: colors.ink,
    minHeight: 48,
  },
  listContent: { paddingBottom: 24 },
  noResult: { fontSize: 13.5, color: colors.mut, textAlign: 'center', paddingVertical: 40 },
  meta: { marginTop: 14 },
});
