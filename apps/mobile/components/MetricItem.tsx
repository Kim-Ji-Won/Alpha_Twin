// specs/components.md — MetricRow (.kv): 라벨 + mono 값, 방향 있으면 색+기호.
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { Direction } from '@/src/types';
import { directionColor, directionSymbol } from '@/lib/direction';
import { font } from '@/lib/fonts';

export interface MetricItemProps {
  label: string;
  value: string;
  direction?: Direction;
  /** 리스트 첫 행은 구분선 없음 (.kv:first-child) */
  first?: boolean;
  style?: ViewStyle;
}

export function MetricItem({ label, value, direction, first, style }: MetricItemProps) {
  const color = direction ? directionColor(direction) : colors.ink;
  const symbol = direction ? directionSymbol(direction) : '';
  return (
    <View
      style={[styles.row, first ? null : styles.divider, style]}
      accessibilityLabel={`${label} ${value}${symbol ? ` ${symbol}` : ''}`}>
      <Text style={[styles.label, { fontFamily: font('body', '600') }]}>{label}</Text>
      <Text style={[styles.value, { color, fontFamily: font('mono', '600') }]}>
        {value}
        {symbol ? ` ${symbol}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    minHeight: 36,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  label: { fontSize: 13.5, color: colors.mut, fontWeight: '600', flexShrink: 1 },
  value: { fontSize: 13.5, fontWeight: '600' },
});
