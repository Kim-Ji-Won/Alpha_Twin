// P2 — 관심 종목 추가/해제: 전체 종목 검색 + 토글.
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { DataMetadata } from '@/components/DataMetadata';
import { StaticTabBar } from '@/components/StaticTabBar';
import { ErrorState, LoadingState } from '@/components/States';
import { font } from '@/lib/fonts';
import { useAsync } from '@/lib/useAsync';
import { useSafeBack } from '@/lib/useSafeBack';
import { stockService, watchlistService } from '@/src/services';
import { alpha, colors } from '@/src/theme';

export default function WatchlistAddRoute() {
  const goBack = useSafeBack('/(tabs)/twin');
  const [query, setQuery] = useState('');

  const { status, data, reload } = useAsync(
    async () => {
      const [stocks, saved] = await Promise.all([
        stockService.getWatchlist(),
        watchlistService.symbols(),
      ]);
      return { stocks, saved: new Set(saved) };
    },
    [],
    { isEmpty: () => false },
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim();
    if (!q) return data.stocks;
    return data.stocks.filter(s => s.name.includes(q) || s.symbol.includes(q) || s.sector.includes(q));
  }, [data, query]);

  if (status === 'loading') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <LoadingState stage="종목 목록 불러오는 중" />
      </AppScreen>
    );
  }
  if (status !== 'success' || !data) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <ErrorState onRetry={reload} />
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
      <AppHeader onBack={goBack} subtitle="관심 종목" title="종목 추가" />
      <View style={styles.search}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="종목명 · 코드 · 산업 검색"
          placeholderTextColor={colors.dim}
          accessibilityLabel="종목 검색"
          style={[styles.searchInput, { fontFamily: font('body', '500') }]}
        />
      </View>
      <FlatList
        data={filtered}
        keyExtractor={s => s.symbol}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={[styles.noResult, { fontFamily: font('body', '500') }]}>
            '{query}'와 일치하는 종목이 없습니다.
          </Text>
        }
        ListFooterComponent={
          <DataMetadata items={['Mock 종목 목록 · 실시간 시세 연동은 P3']} style={styles.meta} />
        }
        renderItem={({ item, index }) => {
          const saved = data.saved.has(item.symbol);
          return (
            <View style={[styles.row, index > 0 && styles.divider]}>
              <View style={styles.logo}>
                <Text style={[styles.logoText, { fontFamily: font('mono', '700') }]}>
                  {item.name.slice(0, 2)}
                </Text>
              </View>
              <View style={styles.body}>
                <Text style={[styles.name, { fontFamily: font('body', '700') }]}>{item.name}</Text>
                <Text style={[styles.metaText, { fontFamily: font('mono', '500') }]}>
                  {item.symbol} · {item.sector}
                </Text>
              </View>
              <Pressable
                onPress={async () => {
                  await watchlistService.toggle(item.symbol);
                  reload();
                }}
                accessibilityRole="button"
                accessibilityLabel={saved ? `${item.name} 관심 해제` : `${item.name} 관심 추가`}
                accessibilityState={{ selected: saved }}
                style={({ pressed }) => [
                  styles.toggle,
                  saved && styles.toggleOn,
                  { opacity: pressed ? 0.7 : 1 },
                ]}>
                <Text
                  style={[
                    styles.toggleText,
                    saved && { color: colors.accent },
                    { fontFamily: font('body', '600') },
                  ]}>
                  {saved ? '✓ 저장됨' : '+ 추가'}
                </Text>
              </Pressable>
            </View>
          );
        }}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 2,
    minHeight: 60,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#111a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 11, fontWeight: '700', color: colors.accent },
  body: { flex: 1 },
  name: { fontSize: 14, fontWeight: '700', color: colors.ink },
  metaText: { fontSize: 11, color: colors.dim, marginTop: 3 },
  toggle: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 99,
    paddingVertical: 8,
    paddingHorizontal: 13,
    minHeight: 36,
    justifyContent: 'center',
  },
  toggleOn: { borderColor: alpha.accentBorder, backgroundColor: alpha.accent08 },
  toggleText: { fontSize: 12, color: '#cdd7e8', fontWeight: '600' },
  noResult: { fontSize: 13.5, color: colors.mut, textAlign: 'center', paddingVertical: 40 },
  meta: { marginTop: 14 },
});
