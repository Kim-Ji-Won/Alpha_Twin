// 디자인 .legend — 차트 범례: 컬러 키 + 라벨.
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';

export interface ChartLegendItem {
  color: string;
  label: string;
  /** line = 14×3 바 · dot = 원 (기본 line) */
  kind?: 'line' | 'dot';
}

export interface ChartLegendProps {
  items: ChartLegendItem[];
  style?: ViewStyle;
}

export function ChartLegend({ items, style }: ChartLegendProps) {
  return (
    <View style={[styles.wrap, style]}>
      {items.map(item => (
        <View key={item.label} style={styles.item} accessibilityLabel={item.label}>
          <View
            style={[
              item.kind === 'dot' ? styles.dot : styles.line,
              { backgroundColor: item.color },
            ]}
          />
          <Text style={[styles.label, { fontFamily: font('body', '600') }]}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  line: { width: 14, height: 3, borderRadius: 2 },
  dot: { width: 7, height: 7, borderRadius: 99 },
  label: { fontSize: 11, color: colors.mut, fontWeight: '600' },
});
