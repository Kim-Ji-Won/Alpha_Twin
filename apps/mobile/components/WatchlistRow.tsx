// 프레임 24 — 관심 종목 행 (.wrow): 로고 + 이름/가격/상태바 + 상태 점수/논제 상태.
// narrative_gap 플래그 종목은 괴리 하이라이트 (amber 틴트).
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { InvestmentThesis, Stock } from '@/src/types';
import { font } from '@/lib/fonts';
import { formatKRW, formatPct } from '@/lib/format';
import { StatusBadge } from '@/components/StatusBadge';

export interface WatchlistRowProps {
  stock: Stock;
  thesis: InvestmentThesis | null;
  onPress?: () => void;
  onLongPress?: () => void;
  first?: boolean;
  style?: ViewStyle;
}

export function WatchlistRow({ stock, thesis, onPress, onLongPress, first, style }: WatchlistRowProps) {
  const gap = stock.flags?.includes('narrative_gap') ?? false;
  const changeColor = stock.changePct > 0 ? colors.pos : stock.changePct < 0 ? colors.neg : colors.mut;
  const scoreColor = gap ? colors.warn : colors.ink;
  const barColor = gap ? colors.warn : colors.accent;

  const thesisText = gap
    ? '확인 필요'
    : thesis
      ? `논제 ${thesis.healthScore} ${thesis.healthTrend.delta >= 0 ? '▲' : '▼'}${Math.abs(thesis.healthTrend.delta)}`
      : '논제 없음';
  const thesisColor = gap
    ? colors.warn
    : thesis
      ? thesis.healthTrend.delta >= 0
        ? colors.pos
        : colors.neg
      : colors.dim;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${stock.name}, ${formatKRW(stock.price)}, ${formatPct(stock.changePct)}, 기업 상태 ${stock.healthScore}점, ${thesisText}${gap ? ', 괴리 주의' : ''}`}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        gap && styles.gapRow,
        { opacity: pressed ? 0.75 : 1 },
        style,
      ]}>
      <View style={styles.logo}>
        <Text style={[styles.logoText, { fontFamily: font('mono', '700') }]}>
          {stock.name.slice(0, 2)}
        </Text>
      </View>
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { fontFamily: font('body', '700') }]}>{stock.name}</Text>
          {gap ? <StatusBadge label="◆ 괴리" tone="warn" size="sm" /> : null}
        </View>
        <Text style={[styles.price, { fontFamily: font('mono', '500') }]}>
          {formatKRW(stock.price)} ·{' '}
          <Text style={{ color: changeColor }}>{formatPct(stock.changePct)}</Text>
        </Text>
        <View style={styles.bar}>
          <View
            style={[styles.barFill, { width: `${stock.healthScore}%`, backgroundColor: barColor }]}
          />
        </View>
      </View>
      <View style={styles.score}>
        <Text style={[styles.scoreValue, { color: scoreColor, fontFamily: font('mono', '700') }]}>
          {stock.healthScore}
        </Text>
        <Text style={[styles.scoreLabel, { fontFamily: font('body', '500') }]}>상태</Text>
        <Text style={[styles.thesis, { color: thesisColor, fontFamily: font('mono', '600') }]}>
          {thesisText}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 2,
    minHeight: 68,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  gapRow: {
    backgroundColor: 'rgba(251,191,36,0.05)',
    marginHorizontal: -8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderTopColor: 'transparent',
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#111a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { fontSize: 11, fontWeight: '700', color: colors.accent },
  body: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  price: { fontSize: 11, color: colors.dim, marginTop: 3 },
  bar: {
    width: 56,
    height: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    marginTop: 5,
  },
  barFill: { height: '100%', borderRadius: 99 },
  score: { alignItems: 'flex-end' },
  scoreValue: { fontSize: 16, fontWeight: '700' },
  scoreLabel: { fontSize: 10.5, color: colors.dim, marginTop: 2 },
  thesis: { fontSize: 10.5, marginTop: 2 },
});
