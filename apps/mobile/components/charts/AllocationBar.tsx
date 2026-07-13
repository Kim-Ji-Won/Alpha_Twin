// specs/components.md — AllocationBar: 산업별 비중 스택 바 + 레전드 (프레임 06).
import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { chartColors } from '@/src/theme';
import { ChartLegend } from '@/components/ChartLegend';

export interface AllocationBarProps {
  items: { label: string; weight: number }[];
  style?: ViewStyle;
}

export function AllocationBar({ items, style }: AllocationBarProps) {
  const palette = chartColors.allocation;
  const total = items.reduce((s, i) => s + i.weight, 0) || 1;
  const a11y = items
    .map(i => `${i.label} ${Math.round((i.weight / total) * 100)}%`)
    .join(', ');
  return (
    <View style={style} accessibilityLabel={`산업별 비중: ${a11y}`}>
      <View style={styles.bar}>
        {items.map((item, i) => (
          <View
            key={item.label}
            style={[
              styles.segment,
              { flex: item.weight / total, backgroundColor: palette[i % palette.length] },
            ]}
          />
        ))}
      </View>
      <ChartLegend
        items={items.map((item, i) => ({
          color: palette[i % palette.length],
          label: `${item.label} ${Math.round((item.weight / total) * 100)}%`,
        }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    height: 14,
    borderRadius: 99,
    overflow: 'hidden',
    gap: 2,
    marginTop: 12,
  },
  segment: { height: '100%', borderRadius: 2 },
});
