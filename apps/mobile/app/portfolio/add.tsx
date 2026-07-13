// Frame 20 — 보유 종목 추가: 증권사 연결(준비 중) / 수동 입력 + 매수 이유 → 논제 유도.
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { DataMetadata } from '@/components/DataMetadata';
import { Panel } from '@/components/Panel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SecondaryButton } from '@/components/SecondaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { StaticTabBar } from '@/components/StaticTabBar';
import { font } from '@/lib/fonts';
import { useSafeBack } from '@/lib/useSafeBack';
import { portfolioService, stockService } from '@/src/services';
import { alpha, colors } from '@/src/theme';
import { Stock } from '@/src/types';

export default function PortfolioAddRoute() {
  const router = useRouter();
  const goBack = useSafeBack('/portfolio/holdings');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Stock[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Stock | null>(null);
  const [qty, setQty] = useState('');
  const [avgPrice, setAvgPrice] = useState('');
  const [purchasedAt, setPurchasedAt] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);

  const search = async (text: string) => {
    setQuery(text);
    setSelected(null);
    if (!text.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const found = await stockService.search(text.trim());
      if (alive.current) setResults(found);
    } finally {
      if (alive.current) setSearching(false);
    }
  };

  const qtyNum = parseInt(qty, 10);
  const priceNum = parseInt(avgPrice.replaceAll(',', ''), 10);
  const valid = selected != null && qtyNum > 0 && priceNum > 0;

  const save = async (withThesis: boolean) => {
    if (!valid || !selected || saving) return; // 로딩 중 중복 실행 방지
    setSaving(true);
    try {
      await portfolioService.addHolding({
        symbol: selected.symbol,
        name: selected.name,
        qty: qtyNum,
        avgPrice: priceNum,
        note: note.trim() || undefined,
        purchasedAt: purchasedAt.trim() || undefined,
      });
      if (!alive.current) return;
      if (withThesis) {
        router.replace({ pathname: '/thesis/[symbol]/edit', params: { symbol: selected.symbol } });
      } else {
        goBack();
      }
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  return (
    <AppScreen keyboardAvoid edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="portfolio" />}>
      <AppHeader onBack={goBack} subtitle="Portfolio" title="보유 종목 추가" />

      {/* 입력 방식 타일 — 증권사 연결은 P3 (조회 전용 준비 중) */}
      <View style={styles.tiles}>
        <View style={[styles.tile, styles.tileDisabled]} accessibilityLabel="증권사 연결 — 준비 중">
          <View style={styles.tileIcon}>
            <Svg width={15} height={15} viewBox="0 0 16 16">
              <Path
                d="M6.5 9.5a3 3 0 0 0 4.2.3l2-2a3 3 0 0 0-4.2-4.2l-1 1M9.5 6.5a3 3 0 0 0-4.2-.3l-2 2a3 3 0 0 0 4.2 4.2l1-1"
                stroke={colors.dim}
                strokeWidth={1.6}
                strokeLinecap="round"
                fill="none"
              />
            </Svg>
          </View>
          <Text style={[styles.tileTitle, { color: colors.mut, fontFamily: font('body', '800') }]}>
            증권사 연결
          </Text>
          <Text style={[styles.tileBody, { fontFamily: font('body', '500') }]}>
            조회 전용 · 주문 불가. 실제 연동은 준비 중입니다.
          </Text>
        </View>
        <View style={[styles.tile, styles.tileActive]} accessibilityLabel="수동 입력 — 선택됨">
          <View style={[styles.tileIcon, { backgroundColor: alpha.accent12 }]}>
            <Svg width={15} height={15} viewBox="0 0 16 16">
              <Path d="M8 3v10M3 8h10" stroke={colors.accent} strokeWidth={1.6} strokeLinecap="round" />
            </Svg>
          </View>
          <Text style={[styles.tileTitle, { fontFamily: font('body', '800') }]}>수동 입력</Text>
          <Text style={[styles.tileBody, { fontFamily: font('body', '500') }]}>
            종목·수량·평균단가를 직접 입력합니다.
          </Text>
        </View>
      </View>

      <SectionHeader label="수동 입력" />

      {/* 종목 검색·선택 */}
      <View style={styles.field}>
        <View style={styles.fieldBody}>
          <Text style={[styles.fieldLabel, { fontFamily: font('body', '700') }]}>종목</Text>
          {selected ? (
            <Text style={[styles.fieldValue, { fontFamily: font('body', '600') }]}>
              {selected.name} · <Text style={{ fontFamily: font('mono', '600') }}>{selected.symbol}</Text>
            </Text>
          ) : (
            <TextInput
              value={query}
              onChangeText={search}
              placeholder="종목명 또는 코드 검색"
              placeholderTextColor={colors.dim}
              accessibilityLabel="종목 검색"
              style={[styles.fieldInput, { fontFamily: font('body', '500') }]}
            />
          )}
        </View>
        {selected ? (
          <Pressable
            onPress={() => {
              setSelected(null);
              setQuery('');
              setResults([]);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="종목 변경">
            <Text style={[styles.change, { fontFamily: font('mono', '600') }]}>변경</Text>
          </Pressable>
        ) : null}
      </View>
      {!selected && query.trim() ? (
        <Panel style={styles.results}>
          {searching ? (
            <Text style={[styles.resultEmpty, { fontFamily: font('body', '500') }]}>검색 중…</Text>
          ) : results.length === 0 ? (
            <Text style={[styles.resultEmpty, { fontFamily: font('body', '500') }]}>
              '{query}' 검색 결과가 없습니다.
            </Text>
          ) : (
            results.map((s, i) => (
              <Pressable
                key={s.symbol}
                onPress={() => setSelected(s)}
                accessibilityRole="button"
                accessibilityLabel={`${s.name} 선택`}
                style={({ pressed }) => [
                  styles.resultRow,
                  i > 0 && styles.resultDivider,
                  { opacity: pressed ? 0.7 : 1 },
                ]}>
                <Text style={[styles.resultName, { fontFamily: font('body', '700') }]}>{s.name}</Text>
                <Text style={[styles.resultMeta, { fontFamily: font('mono', '500') }]}>
                  {s.symbol} · {s.sector}
                </Text>
              </Pressable>
            ))
          )}
        </Panel>
      ) : null}

      {/* 수량 · 평균단가 · 매입일 */}
      <View style={styles.g2}>
        <View style={[styles.field, styles.fieldHalf]}>
          <View style={styles.fieldBody}>
            <Text style={[styles.fieldLabel, { fontFamily: font('body', '700') }]}>수량</Text>
            <TextInput
              value={qty}
              onChangeText={setQty}
              placeholder="24"
              placeholderTextColor={colors.dim}
              keyboardType="number-pad"
              accessibilityLabel="보유 수량 입력"
              style={[styles.fieldInput, { fontFamily: font('mono', '600') }]}
            />
          </View>
          <Text style={[styles.unit, { fontFamily: font('mono', '500') }]}>주</Text>
        </View>
        <View style={[styles.field, styles.fieldHalf]}>
          <View style={styles.fieldBody}>
            <Text style={[styles.fieldLabel, { fontFamily: font('body', '700') }]}>평균단가</Text>
            <TextInput
              value={avgPrice}
              onChangeText={setAvgPrice}
              placeholder="168,500"
              placeholderTextColor={colors.dim}
              keyboardType="number-pad"
              accessibilityLabel="평균 매입가 입력"
              style={[styles.fieldInput, { fontFamily: font('mono', '600') }]}
            />
          </View>
          <Text style={[styles.unit, { fontFamily: font('mono', '500') }]}>원</Text>
        </View>
      </View>
      <View style={styles.field}>
        <View style={styles.fieldBody}>
          <Text style={[styles.fieldLabel, { fontFamily: font('body', '700') }]}>매입일 (선택)</Text>
          <TextInput
            value={purchasedAt}
            onChangeText={setPurchasedAt}
            placeholder="2026-07-13"
            placeholderTextColor={colors.dim}
            accessibilityLabel="매입일 입력"
            style={[styles.fieldInput, { fontFamily: font('mono', '600') }]}
          />
        </View>
      </View>

      {/* 매수 이유 → 투자 논제 유도 (프레임 20 alert 패널) */}
      <Panel variant="alert" style={styles.reason}>
        <Text style={[styles.reasonTitle, { fontFamily: font('body', '700') }]}>
          ✦ 매수 이유를 남겨두세요
        </Text>
        <Text style={[styles.reasonBody, { fontFamily: font('body', '500') }]}>
          이 종목을 산 이유를 한 문장으로 적으면, AI가 투자 논제로 구조화하고 새로운 뉴스·실적이 나올
          때마다 유효한지 검증합니다.
        </Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="HBM 경쟁력 회복으로 실적이 개선될 것 같아서…"
          placeholderTextColor={colors.dim}
          multiline
          accessibilityLabel="매수 이유 입력"
          style={[styles.reasonInput, { fontFamily: font('body', '500') }]}
        />
      </Panel>

      <View style={styles.cta}>
        <SecondaryButton
          label="이유는 나중에"
          onPress={() => save(false)}
          disabled={!valid || saving}
          style={styles.ctaSub}
        />
        <PrimaryButton
          label={saving ? '저장 중…' : '추가 + 논제 만들기'}
          onPress={() => save(true)}
          disabled={!valid || saving}
          style={styles.ctaMain}
        />
      </View>

      <DataMetadata
        items={['잔고·매매 기능이 없는 분석 전용 기록입니다']}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: 10 },
  tile: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    padding: 16,
  },
  tileDisabled: { opacity: 0.75 },
  tileActive: { borderColor: 'rgba(34,211,238,0.4)', backgroundColor: 'rgba(34,211,238,0.06)' },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTitle: { fontSize: 14.5, fontWeight: '800', color: colors.ink, marginTop: 12 },
  tileBody: { fontSize: 12.5, lineHeight: 19, color: colors.mut, marginTop: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginBottom: 10,
    minHeight: 56,
  },
  fieldHalf: { flex: 1, marginBottom: 0 },
  fieldBody: { flex: 1 },
  fieldLabel: {
    fontSize: 10.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.dim,
    fontWeight: '700',
    marginBottom: 2,
  },
  fieldValue: { fontSize: 14, color: '#e2e9f5', fontWeight: '600', paddingVertical: 4 },
  fieldInput: { fontSize: 14, color: colors.ink, paddingVertical: 4, padding: 0 },
  change: { fontSize: 12, color: colors.accent, fontWeight: '600' },
  unit: { fontSize: 12, color: colors.dim },
  results: { marginTop: -4 },
  resultRow: { paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  resultDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  resultName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  resultMeta: { fontSize: 11, color: colors.dim, marginTop: 3 },
  resultEmpty: { fontSize: 13, color: colors.mut, paddingVertical: 6 },
  g2: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  reason: { marginTop: 4 },
  reasonTitle: { fontSize: 11.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.accent, fontWeight: '700' },
  reasonBody: { fontSize: 13.5, lineHeight: 21, color: '#b8c4da', marginTop: 9 },
  reasonInput: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 13,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 13.5,
    color: colors.ink,
    minHeight: 48,
  },
  cta: { flexDirection: 'row', gap: 10, marginTop: 2 },
  ctaSub: { flex: 0.8 },
  ctaMain: { flex: 1 },
  meta: { marginTop: 14, textAlign: 'center' },
});
