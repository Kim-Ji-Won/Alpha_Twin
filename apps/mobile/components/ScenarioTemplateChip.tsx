// 디자인 프레임 03 .tkgrid .tk — 빠른 시나리오 템플릿 타일.
// 선택 시 accent 보더+틴트 (SelectableChip 규칙).
import React from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { alpha, colors } from '@/src/theme';
import { font } from '@/lib/fonts';

export interface ScenarioTemplateChipProps {
  label: string;
  valueLabel: string;
  selected: boolean;
  onPress: () => void;
  style?: ViewStyle;
}

export function ScenarioTemplateChip({
  label,
  valueLabel,
  selected,
  onPress,
  style,
}: ScenarioTemplateChipProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`시나리오 템플릿: ${label} ${valueLabel}`}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.tile,
        selected && styles.tileOn,
        { opacity: pressed ? 0.8 : 1 },
        style,
      ]}>
      <Text
        style={[styles.label, selected && { color: colors.ink }, { fontFamily: font('body', '600') }]}
        numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.value, { fontFamily: font('mono', '600') }]} numberOfLines={1}>
        {valueLabel}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 7,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(255,255,255,0.035)',
    minHeight: 44,
  },
  tileOn: { borderColor: alpha.accentBorder, backgroundColor: alpha.accent08 },
  label: { fontSize: 13, fontWeight: '600', color: '#d2dcec', flexShrink: 1 },
  value: { fontSize: 11.5, color: colors.accent, fontWeight: '600' },
});
