// Frame 19 — 관심 산업 → 종목 개인화 (2/3 단계)
// 데이터는 반드시 서비스 계층으로만 (HANDOFF: 화면은 src/services만 호출)
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SecondaryButton } from '@/components/SecondaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { font } from '@/lib/fonts';
import { colors } from '@/src/theme';
import { stockService } from '@/src/services';
import { Stock } from '@/src/types';

const INDUSTRIES = [
  '반도체',
  '전력 인프라',
  '2차전지',
  '자동차',
  'AI 소프트웨어',
  '바이오',
  '금융',
  '엔터',
  '방산',
  '조선',
];

// 디자인 프레임 19의 종목 이니셜 표기 (colg)
const INITIALS: Record<string, string> = {
  '000660': 'SK',
  '005930': 'SS',
  '042700': 'HM',
  '010120': 'LS',
  '035420': 'NA',
  '005380': 'HD',
};

function IndustryChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityLabel={`${label} 산업`}
      accessibilityState={{ checked: selected }}
      style={[styles.tk, selected && styles.tkOn]}>
      <Text
        style={[
          styles.tkLabel,
          selected && { color: colors.ink },
          { fontFamily: font('body', '600') },
        ]}>
        {label}
      </Text>
      {selected ? (
        <Text style={[styles.tkCheck, { fontFamily: font('mono', '500') }]}>✓</Text>
      ) : null}
    </Pressable>
  );
}

function StockRow({
  stock,
  selected,
  onToggle,
}: {
  stock: Stock;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityLabel={`${stock.name} · ${stock.symbol} · ${stock.sector}`}
      accessibilityState={{ checked: selected }}
      style={styles.wrow}>
      <View style={styles.colg}>
        <Text style={[styles.colgText, { fontFamily: font('mono', '700') }]}>
          {INITIALS[stock.symbol] ?? stock.name.slice(0, 2)}
        </Text>
      </View>
      <View style={styles.wn}>
        <Text style={[styles.t1, { fontFamily: font('body', '700') }]}>{stock.name}</Text>
        <Text style={[styles.t2, { fontFamily: font('mono', '400') }]}>
          {stock.symbol} · {stock.sector}
        </Text>
      </View>
      <View style={[styles.chip, selected && styles.chipOn]}>
        <Text
          style={[
            styles.chipText,
            selected && { color: colors.accent },
            { fontFamily: font('body', '600') },
          ]}>
          {selected ? '✓ 선택' : '+ 추가'}
        </Text>
      </View>
    </Pressable>
  );
}

export default function InterestsRoute() {
  const router = useRouter();
  const [industries, setIndustries] = useState<string[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    stockService.search('').then(setStocks);
  }, []);

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter(x => x !== v) : [...list, v];

  // 선택 산업 기반 추천 — 없으면 전체 (Mock 단계 단순 매칭)
  const recommended = useMemo(() => {
    if (industries.length === 0) return stocks;
    const match = stocks.filter(s => industries.some(i => s.sector.includes(i) || i.includes(s.sector)));
    return match.length > 0 ? match : stocks;
  }, [stocks, industries]);

  const goHome = () => router.replace('/(tabs)/home');

  return (
    <AppScreen>
      <View style={styles.steps} accessibilityLabel="3단계 중 2단계">
        <View style={[styles.sdot, styles.sdotOn]} />
        <View style={[styles.sdot, styles.sdotOn]} />
        <View style={styles.sdot} />
      </View>

      <Text style={[styles.dt, { fontFamily: font('body', '600') }]}>2 / 3 단계</Text>
      <Text style={[styles.h1, { fontFamily: font('body', '800') }]} accessibilityRole="header">
        관심 산업을 선택하세요
      </Text>
      <Text style={[styles.cap, { fontFamily: font('body', '500') }]}>
        선택한 산업의 시장 국면과 이상 신호가 Market Brain에 우선 표시됩니다.
      </Text>

      <View style={styles.chips}>
        {INDUSTRIES.map(ind => (
          <IndustryChip
            key={ind}
            label={ind}
            selected={industries.includes(ind)}
            onPress={() => setIndustries(prev => toggle(prev, ind))}
          />
        ))}
      </View>

      <SectionHeader label="추천 종목 · 선택 산업 기반" meta={`${picked.length} 선택됨`} />
      <View>
        {recommended.map(s => (
          <StockRow
            key={s.symbol}
            stock={s}
            selected={picked.includes(s.symbol)}
            onToggle={() => setPicked(prev => toggle(prev, s.symbol))}
          />
        ))}
      </View>

      <View style={styles.cta}>
        <SecondaryButton label="건너뛰기" onPress={goHome} style={styles.ctaSkip} />
        <PrimaryButton label="다음 · 트윈 생성" onPress={goHome} style={styles.ctaNext} />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 18 },
  sdot: { flex: 1, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.12)' },
  sdotOn: { backgroundColor: colors.accent },
  dt: {
    fontSize: 12.5,
    color: colors.dim,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  h1: { marginTop: 3, fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: colors.ink },
  cap: { marginTop: 8, marginBottom: 16, fontSize: 14, lineHeight: 23, color: colors.mut },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  tk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    minHeight: 40,
  },
  tkOn: { borderColor: 'rgba(34,211,238,0.5)', backgroundColor: 'rgba(34,211,238,0.1)' },
  tkLabel: { fontSize: 13, fontWeight: '600', color: '#d2dcec' },
  tkCheck: { fontSize: 11, color: colors.accent },
  wrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 2,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    minHeight: 56,
  },
  colg: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#111c31',
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colgText: { fontSize: 11, fontWeight: '700', color: colors.accent },
  wn: { flex: 1 },
  t1: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  t2: { fontSize: 11, color: colors.dim, marginTop: 3 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  chipOn: { borderColor: 'rgba(34,211,238,0.4)' },
  chipText: { fontSize: 12.5, fontWeight: '600', color: '#cdd7e8' },
  cta: { flexDirection: 'row', gap: 10, marginTop: 20 },
  ctaSkip: { flex: 0.6 },
  ctaNext: { flex: 1 },
});
