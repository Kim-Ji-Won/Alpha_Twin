// specs/components.md — FacetBar (.facet .ft): 라벨 + 트랙 바 + mono 값.
// Company Twin 상태 영역, Scenario 영향 재무 항목(ImpactBar 용도) 공용.
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';

export interface FactorRowProps {
  label: string;
  /** 0..1 — 바 채움 비율 */
  pct: number;
  /** 바 색 */
  tone: string;
  valueText: string;
  /** 값 텍스트 색 (기본 mut) */
  valueColor?: string;
  /** 라벨 열 너비 (디자인: 78 기본 · 결과 화면 88) */
  labelWidth?: number;
  style?: ViewStyle;
}

export function FactorRow({
  label,
  pct,
  tone,
  valueText,
  valueColor = colors.mut,
  labelWidth = 78,
  style,
}: FactorRowProps) {
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <View style={[styles.row, style]} accessibilityLabel={`${label} ${valueText}`}>
      <Text
        style={[styles.label, { width: labelWidth, fontFamily: font('body', '600') }]}
        numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: tone }]} />
      </View>
      <Text
        style={[styles.value, { color: valueColor, fontFamily: font('mono', '600') }]}
        numberOfLines={1}>
        {valueText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 5 },
  label: { fontSize: 12.5, color: '#cdd7e8', fontWeight: '600' },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 99 },
  value: { minWidth: 44, textAlign: 'right', fontSize: 12, fontWeight: '600' },
});
