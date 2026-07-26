// Frame 24 — 관심 종목: 트윈 요약 행 + 필터 + 정렬 + 괴리 하이라이트.
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { DataMetadata } from '@/components/DataMetadata';
import { WatchlistRow } from '@/components/WatchlistRow';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { font } from '@/lib/fonts';
import { WatchlistEntry, useWatchlist } from '@/lib/hooks';
import { alpha, colors } from '@/src/theme';
import { watchlistService } from '@/src/services';

const FILTERS = [
  { label: '전체', enabled: true },
  { label: '논제 있음', enabled: true },
  { label: '변화 큼', enabled: false },
  { label: '반도체', enabled: false },
] as const;
type Filter = (typeof FILTERS)[number]['label'];

const SORTS = [
  { label: '등락률', enabled: true },
  { label: '기업 상태', enabled: false },
  { label: '논제 건강도', enabled: false },
  { label: '위험 수준', enabled: false },
  { label: '추가순', enabled: true },
] as const;
type Sort = (typeof SORTS)[number]['label'];

function applyFilter(entries: WatchlistEntry[], filter: Filter): WatchlistEntry[] {
  switch (filter) {
    case '논제 있음':
      return entries.filter(e => e.thesisExists);
    default:
      return entries;
  }
}

function applySort(entries: WatchlistEntry[], sort: Sort): WatchlistEntry[] {
  const list = [...entries];
  switch (sort) {
    case '등락률':
      return list.sort((a, b) => {
        const aChange = a.market.quote?.changePercent;
        const bChange = b.market.quote?.changePercent;
        if (aChange == null && bChange == null) return a.savedOrder - b.savedOrder;
        if (aChange == null) return 1;
        if (bChange == null) return -1;
        return bChange - aChange;
      });
    default:
      return list.sort((a, b) => a.savedOrder - b.savedOrder);
  }
}

export default function TwinTab() {
  const router = useRouter();
  const { status, data, reload } = useWatchlist();
  const [filter, setFilter] = useState<Filter>('전체');
  const [sort, setSort] = useState<Sort>('추가순');
  const [pendingRemove, setPendingRemove] = useState<WatchlistEntry | null>(null);

  const entries = useMemo(
    () => (data ? applySort(applyFilter(data, filter), sort) : []),
    [data, filter, sort],
  );

  const thesisCount = data?.filter(e => e.thesisExists).length ?? 0;

  const header = (
    <AppHeader
      subtitle={data ? `저장한 트윈 ${data.length} · 논제 ${thesisCount}` : '디지털 트윈'}
      title="관심 종목"
      right={
        <Pressable
          onPress={() => router.push('/watchlist/add')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="관심 종목 추가"
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
      <AppScreen scroll={false} edges={['top', 'left', 'right']}>
        {header}
        <LoadingState stage="트윈 목록 동기화 중" />
      </AppScreen>
    );
  }
  if (status === 'error') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']}>
        {header}
        <ErrorState onRetry={reload} />
      </AppScreen>
    );
  }
  if (status === 'empty' || !data) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']}>
        {header}
        <EmptyState
          title="저장한 트윈이 없어요"
          message="관심 종목을 추가하면 기업 상태와 투자 논제를 한눈에 감시할 수 있습니다."
          actionLabel="관심 종목 추가"
          onAction={() => router.push('/watchlist/add')}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll={false} edges={['top', 'left', 'right']}>
      {header}

      {/* 필터 칩 (디자인 .tk) */}
      <View style={styles.chips}>
        {FILTERS.map(({ label, enabled }) => (
          <Pressable
            key={label}
            disabled={!enabled}
            onPress={() => setFilter(label)}
            accessibilityRole="button"
            accessibilityLabel={`필터: ${label}${enabled ? '' : ', 준비 중'}`}
            accessibilityState={{ selected: filter === label, disabled: !enabled }}
            style={({ pressed }) => [
              styles.chip,
              filter === label && styles.chipOn,
              !enabled && styles.chipDisabled,
              { opacity: pressed ? 0.7 : 1 },
            ]}>
            <Text
              style={[
                styles.chipText,
                filter === label && { color: colors.accent },
                { fontFamily: font('body', '600') },
              ]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {/* 정렬 칩 */}
      <View style={styles.chips}>
        {SORTS.map(({ label, enabled }) => (
          <Pressable
            key={label}
            disabled={!enabled}
            onPress={() => setSort(label)}
            accessibilityRole="button"
            accessibilityLabel={`정렬: ${label}${enabled ? '' : ', 준비 중'}`}
            accessibilityState={{ selected: sort === label, disabled: !enabled }}
            style={({ pressed }) => [
              styles.sortChip,
              sort === label && styles.chipOn,
              !enabled && styles.chipDisabled,
              { opacity: pressed ? 0.7 : 1 },
            ]}>
            <Text
              style={[
                styles.sortText,
                sort === label && { color: colors.accent },
                { fontFamily: font('body', '600') },
              ]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={entries}
        keyExtractor={e => e.symbol}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={[styles.noMatch, { fontFamily: font('body', '500') }]}>
            '{filter}' 조건에 맞는 종목이 없습니다.
          </Text>
        }
        ListFooterComponent={
          <DataMetadata
            items={[
              '최근 확정 시세 · 실시간 아님',
              '분석 기반 필터와 점수는 준비 중',
              '길게 누르면 관심 해제',
            ]}
            style={styles.meta}
          />
        }
        renderItem={({ item, index }) => (
          <WatchlistRow
            entry={item}
            first={index === 0}
            onPress={() =>
              router.push({ pathname: '/company/[symbol]', params: { symbol: item.symbol } })
            }
            onLongPress={() => setPendingRemove(item)}
          />
        )}
      />

      <ConfirmationModal
        visible={pendingRemove != null}
        title="관심 종목 해제"
        message={pendingRemove ? `${pendingRemove.name}을(를) 관심 목록에서 제거할까요?` : ''}
        confirmLabel="제거"
        destructive
        onCancel={() => setPendingRemove(null)}
        onConfirm={async () => {
          if (pendingRemove) {
            await watchlistService.remove(pendingRemove.symbol);
            setPendingRemove(null);
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderRadius: 13,
    paddingVertical: 9,
    paddingHorizontal: 12,
    minHeight: 38,
    justifyContent: 'center',
  },
  sortChip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderRadius: 99,
    paddingVertical: 6,
    paddingHorizontal: 11,
    minHeight: 32,
    justifyContent: 'center',
  },
  chipOn: { borderColor: alpha.accentBorder, backgroundColor: alpha.accent08 },
  chipDisabled: { opacity: 0.42 },
  chipText: { fontSize: 13, color: '#d2dcec', fontWeight: '600' },
  sortText: { fontSize: 11.5, color: colors.mut, fontWeight: '600' },
  listContent: { paddingBottom: 24 },
  noMatch: { fontSize: 13.5, color: colors.mut, textAlign: 'center', paddingVertical: 40 },
  meta: { marginTop: 14 },
});
