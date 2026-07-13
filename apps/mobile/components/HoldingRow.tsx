// P2 — 보유 종목 행: 종목명/코드/산업 + 수량·평균단가 + 평가금액·수익률.
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { PortfolioHolding } from '@/src/types';
import { font } from '@/lib/fonts';
import { formatKRW, formatPct } from '@/lib/format';

export interface HoldingRowProps {
  holding: PortfolioHolding;
  /** 현재가 — 평가금액·수익률 계산 (없으면 평균단가로 표시) */
  currentPrice?: number;
  sector?: string;
  onPress?: () => void;
  first?: boolean;
  style?: ViewStyle;
}

export function HoldingRow({ holding, currentPrice, sector, onPress, first, style }: HoldingRowProps) {
  const price = currentPrice ?? holding.avgPrice;
  const value = holding.qty * price;
  const returnPct = holding.avgPrice > 0 ? ((price - holding.avgPrice) / holding.avgPrice) * 100 : 0;
  const returnColor = returnPct > 0 ? colors.pos : returnPct < 0 ? colors.neg : colors.mut;
  const initials = holding.name.slice(0, 2);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${holding.name} ${holding.qty}주, 평가금액 ${formatKRW(value)}, 수익률 ${formatPct(returnPct)}`}
      style={({ pressed }) => [styles.row, first ? null : styles.divider, { opacity: pressed ? 0.75 : 1 }, style]}>
      <View style={styles.logo}>
        <Text style={[styles.logoText, { fontFamily: font('mono', '700') }]}>{initials}</Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.name, { fontFamily: font('body', '700') }]}>{holding.name}</Text>
        <Text style={[styles.meta, { fontFamily: font('mono', '500') }]}>
          {holding.symbol}
          {sector ? ` · ${sector}` : ''} · {holding.qty}주 · 평단 {formatKRW(holding.avgPrice)}
        </Text>
      </View>
      <View style={styles.values}>
        <Text style={[styles.value, { fontFamily: font('mono', '700') }]}>{formatKRW(value)}</Text>
        <Text style={[styles.return, { color: returnColor, fontFamily: font('mono', '600') }]}>
          {returnPct > 0 ? '▲ ' : returnPct < 0 ? '▼ ' : ''}
          {formatPct(returnPct)}
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
    minHeight: 60,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
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
  name: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 11, color: colors.dim, marginTop: 3 },
  values: { alignItems: 'flex-end' },
  value: { fontSize: 14, fontWeight: '700', color: colors.ink },
  return: { fontSize: 11.5, fontWeight: '600', marginTop: 3 },
});
