// 디자인 프레임 03 .seg — 분석 범위 선택 ('이 종목' / '포트폴리오 전체').
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { alpha, colors } from '@/src/theme';
import { font } from '@/lib/fonts';

export interface SegmentedControlProps {
  options: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  style?: ViewStyle;
}

export function SegmentedControl({ options, selectedIndex, onChange, style }: SegmentedControlProps) {
  return (
    <View style={[styles.wrap, style]} accessibilityRole="tablist">
      {options.map((opt, i) => {
        const on = i === selectedIndex;
        return (
          <Pressable
            key={opt}
            onPress={() => onChange(i)}
            accessibilityRole="tab"
            accessibilityLabel={opt}
            accessibilityState={{ selected: on }}
            style={[styles.item, on && styles.itemOn]}>
            <Text
              style={[
                styles.label,
                on && { color: colors.accent },
                { fontFamily: font('body', '700') },
              ]}>
              {opt}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 13,
    padding: 4,
    gap: 4,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 10,
    minHeight: 40,
  },
  itemOn: { backgroundColor: alpha.accent18 },
  label: { fontSize: 12, fontWeight: '700', color: colors.mut },
});
