// Frame 08 — Discover: 탐색 + 개인화 추천.
// 검색 · 자연어 칩 · AI 이상 신호 · 산업 트윈 · Narrative Gap.
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { DataMetadata } from '@/components/DataMetadata';
import { DiscoverSignalCard } from '@/components/DiscoverSignalCard';
import { FactorRow } from '@/components/FactorRow';
import { Panel } from '@/components/Panel';
import { SectionHeader } from '@/components/SectionHeader';
import { ErrorState, LoadingState } from '@/components/States';
import { directionColor } from '@/lib/direction';
import { font } from '@/lib/fonts';
import { useDiscover } from '@/lib/hooks';
import { discoverService } from '@/src/services';
import { colors } from '@/src/theme';
import { Stock } from '@/src/types';

export default function DiscoverTab() {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const { status, data, reload } = useDiscover();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Stock[] | null>(null);
  const [searching, setSearching] = useState(false);
  const alive = useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);

  const openCompany = (symbol: string) =>
    router.push({ pathname: '/company/[symbol]', params: { symbol } });

  const search = async (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      const found = await discoverService.search(text.trim());
      if (alive.current) setResults(found);
    } finally {
      if (alive.current) setSearching(false);
    }
  };

  const header = <AppHeader subtitle="종목 · 산업 · 테마 · 신호" title="Discover" />;

  if (status === 'loading') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']}>
        {header}
        <LoadingState stage="탐색 신호 수집 중" />
      </AppScreen>
    );
  }
  if (status !== 'success' || !data) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']}>
        {header}
        <ErrorState onRetry={reload} />
      </AppScreen>
    );
  }

  return (
    <AppScreen edges={['top', 'left', 'right']}>
      {header}

      {/* 검색 — 종목명·코드·자연어 */}
      <View style={styles.search}>
        <Svg width={15} height={15} viewBox="0 0 16 16">
          <Circle cx={7} cy={7} r={4.2} stroke={colors.dim} strokeWidth={1.6} fill="none" />
          <Path d="M10.2 10.2L14 14" stroke={colors.dim} strokeWidth={1.6} strokeLinecap="round" />
        </Svg>
        <TextInput
          value={query}
          onChangeText={search}
          placeholder="종목명 · 코드 · 자연어로 검색"
          placeholderTextColor={colors.dim}
          accessibilityLabel="종목 검색"
          style={[styles.searchInput, { fontFamily: font('body', '500') }]}
        />
      </View>

      {/* 검색 결과 (검색 중일 때만) */}
      {results != null ? (
        <Panel>
          <SectionHeader
            label={`검색 결과 · ${results.length}건`}
            meta={searching ? '검색 중' : undefined}
            style={styles.panelHeader}
          />
          {results.length === 0 && !searching ? (
            <View style={styles.noResult}>
              <Text style={[styles.noResultTitle, { fontFamily: font('body', '700') }]}>
                검색 결과 없음
              </Text>
              <Text style={[styles.noResultBody, { fontFamily: font('body', '500') }]}>
                '{query}'와 일치하는 종목이 없습니다. 자연어로 질문해 보세요.
              </Text>
              <Pressable
                onPress={() => router.navigate('/(tabs)/ai')}
                accessibilityRole="button"
                accessibilityLabel="AI Analyst에게 질문"
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <Text style={[styles.noResultAction, { fontFamily: font('body', '700') }]}>
                  AI Analyst에게 질문 →
                </Text>
              </Pressable>
            </View>
          ) : (
            results.map((s, i) => (
              <Pressable
                key={s.symbol}
                onPress={() => openCompany(s.symbol)}
                accessibilityRole="button"
                accessibilityLabel={`${s.name} 기업 트윈 열기`}
                style={({ pressed }) => [
                  styles.resultRow,
                  i > 0 && styles.resultDivider,
                  { opacity: pressed ? 0.7 : 1 },
                ]}>
                <View style={styles.resultBody}>
                  <Text style={[styles.resultName, { fontFamily: font('body', '700') }]}>{s.name}</Text>
                  <Text style={[styles.resultMeta, { fontFamily: font('mono', '500') }]}>
                    {s.symbol} · {s.sector}
                  </Text>
                </View>
                <Text style={[styles.resultScore, { fontFamily: font('mono', '700') }]}>
                  {s.healthScore}
                </Text>
              </Pressable>
            ))
          )}
        </Panel>
      ) : null}

      {/* 자연어 탐색 칩 */}
      <SectionHeader label="자연어 탐색 · Ask" />
      <View style={styles.chips}>
        {discoverService.naturalQueries.map(q => (
          <Pressable
            key={q}
            onPress={() => search(q)}
            accessibilityRole="button"
            accessibilityLabel={`자연어 탐색: ${q}`}
            style={({ pressed }) => [styles.chip, { opacity: pressed ? 0.7 : 1 }]}>
            <Text style={[styles.chipText, { fontFamily: font('body', '600') }]}>{q}</Text>
          </Pressable>
        ))}
      </View>

      {/* AI 이상 신호 */}
      <Panel>
        <SectionHeader label="AI 이상 신호 · Anomaly" meta="● Mock 실시간" style={styles.panelHeader} />
        <View style={styles.signalList}>
          {data.signals.map((sig, i) => (
            <DiscoverSignalCard
              key={sig.id}
              signal={sig}
              first={i === 0}
              onPress={sig.symbol ? () => openCompany(sig.symbol!) : undefined}
            />
          ))}
        </View>
      </Panel>

      {/* 산업 트윈 */}
      <Panel>
        <SectionHeader label="산업 트윈 · Industry" style={styles.panelHeader} />
        <View style={styles.industries}>
          {data.industries.map(ind => (
            <View
              key={ind.name}
              style={styles.industryRow}
              accessibilityLabel={`${ind.name}, 상태 ${ind.score}점`}>
              <View style={styles.industryName}>
                <View style={[styles.dot, { backgroundColor: directionColor(ind.direction) }]} />
                <Text style={[styles.industryText, { fontFamily: font('body', '600') }]}>
                  {ind.name}
                </Text>
              </View>
              <Text
                style={[
                  styles.industryScore,
                  { color: directionColor(ind.direction), fontFamily: font('mono', '600') },
                ]}>
                상태 {ind.score}
              </Text>
            </View>
          ))}
        </View>
      </Panel>

      {/* Narrative Gap */}
      <Panel>
        <Text accessibilityRole="header" style={[styles.gapHeading, { fontFamily: font('body', '700') }]}>
          Narrative Gap 상위 · 기대 vs 실제
        </Text>
        <View style={styles.gaps}>
          {data.narrativeGaps.map(g => {
            const gap = g.narrativeScore - g.revenueEvidence;
            const tone = gap >= 40 ? colors.neg : gap >= 20 ? colors.warn : colors.pos;
            const row = fontScale > 1.3 ? (
              <View style={styles.gapExpanded}>
                <Text style={[styles.gapDetailText, { color: colors.ink, fontFamily: font('body', '600') }]}>{g.label}</Text>
                <Text style={[styles.gapDetailText, { color: tone, fontFamily: font('mono', '600') }]}>
                  {g.narrativeScore}/{g.revenueEvidence}
                </Text>
              </View>
            ) : (
              <FactorRow
                label={g.label}
                pct={g.narrativeScore / 100}
                tone={tone}
                valueText={`${g.narrativeScore}/${g.revenueEvidence}`}
                valueColor={tone}
                labelWidth={96}
              />
            );
            return (
              <View key={g.id}>
                {g.symbol ? (
                  <Pressable
                    onPress={() => openCompany(g.symbol!)}
                    accessibilityRole="button"
                    accessibilityLabel={`${g.label} 기업 트윈 열기 — Narrative ${g.narrativeScore}, Revenue ${g.revenueEvidence}`}
                    style={({ pressed }) => [styles.gapCompany, { opacity: pressed ? 0.7 : 1 }]}>
                    {row}
                  </Pressable>
                ) : (
                  <View>{row}</View>
                )}
                <Pressable
                  onPress={() => router.push({ pathname: '/narrative-gap/[id]', params: { id: g.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${g.label} Narrative Gap Mock 상세 보기`}
                  style={({ pressed }) => [styles.gapDetail, { opacity: pressed ? 0.7 : 1 }]}>
                  <Text style={[styles.gapDetailText, { fontFamily: font('body', '600') }]}>상세 보기</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
        <Text style={[styles.gapFoot, { fontFamily: font('mono', '500') }]}>
          Narrative Score / Revenue Evidence (단위: 점) · 격차가 클수록 기대 선반영 (과열 레드 · 주의 앰버 · 균형 민트)
        </Text>
      </Panel>

      <DataMetadata
        items={['Mock 탐색 데이터 · 실제 신호 연동은 P3', '분석 보조 도구이며 투자 자문이 아닙니다']}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 48,
    marginBottom: 4,
  },
  searchInput: { flex: 1, fontSize: 13.5, color: colors.ink, paddingVertical: 13, padding: 0 },
  panelHeader: { marginTop: 0, marginBottom: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 99,
    paddingVertical: 9,
    paddingHorizontal: 12,
    minHeight: 38,
    justifyContent: 'center',
  },
  chipText: { fontSize: 12.5, color: '#cdd7e8', fontWeight: '600' },
  signalList: { marginTop: 8 },
  industries: { marginTop: 8 },
  industryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 7,
    minHeight: 34,
  },
  industryName: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  dot: { width: 6, height: 6, borderRadius: 99 },
  industryText: { fontSize: 13.5, color: '#cdd7e8', fontWeight: '600' },
  industryScore: { fontSize: 12.5, fontWeight: '600' },
  gaps: { marginTop: 10, gap: 5 },
  gapHeading: { fontSize: 12, color: colors.dim },
  gapExpanded: { gap: 8, paddingVertical: 8 },
  gapCompany: { minHeight: 44, justifyContent: 'center' },
  gapDetail: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 12, marginTop: 4 },
  gapDetailText: { fontSize: 13, color: colors.accent },
  gapFoot: { fontSize: 11, lineHeight: 18, color: colors.dim, marginTop: 9 },
  meta: { marginTop: 4 },
  noResult: { paddingVertical: 14 },
  noResultTitle: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  noResultBody: { fontSize: 13, lineHeight: 20, color: colors.mut, marginTop: 6 },
  noResultAction: { fontSize: 12.5, color: colors.accent, fontWeight: '700', marginTop: 10 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    minHeight: 48,
  },
  resultDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  resultBody: { flex: 1 },
  resultName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  resultMeta: { fontSize: 11, color: colors.dim, marginTop: 3 },
  resultScore: { fontSize: 15, color: colors.accent },
});
