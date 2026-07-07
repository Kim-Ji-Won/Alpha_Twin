// 디자인 .stat(g3 그리드 카드) / .scell(scorestrip 셀) — 라벨 + mono 값 + 보조 텍스트.
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, radius } from '@/src/theme';
import { font } from '@/lib/fonts';

export interface ScoreMetricProps {
  label: string;
  value: string;
  /** 값 색 (기본 ink) */
  valueColor?: string;
  sub?: string;
  subColor?: string;
  /** 'stat' = 독립 카드(Market Brain 지표 3) · 'cell' = 스트립 셀(Company Twin) */
  variant?: 'stat' | 'cell';
  /** 텍스트 값('보통','높음')처럼 큰 mono 숫자가 아닌 경우 */
  textValue?: boolean;
  style?: ViewStyle;
}

export function ScoreMetric({
  label,
  value,
  valueColor = colors.ink,
  sub,
  subColor = colors.dim,
  variant = 'stat',
  textValue = false,
  style,
}: ScoreMetricProps) {
  const cell = variant === 'cell';
  return (
    <View
      style={[cell ? styles.cell : styles.stat, style]}
      accessibilityLabel={`${label} ${value}${sub ? `, ${sub}` : ''}`}>
      <Text style={[cell ? styles.cellLabel : styles.statLabel, { fontFamily: font('body', '600') }]}>
        {label}
      </Text>
      <Text
        style={[
          cell ? styles.cellValue : styles.statValue,
          textValue && (cell ? styles.cellValueText : styles.statValueText),
          { color: valueColor, fontFamily: font(textValue ? 'body' : 'mono', textValue ? '700' : cell ? '800' : '700') },
        ]}
        numberOfLines={1}>
        {value}
      </Text>
      {sub ? (
        <Text
          style={[cell ? styles.cellSub : styles.statSub, { color: subColor, fontFamily: font('mono', '500') }]}
          numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stat: {
    flex: 1,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.panel - 2,
    paddingVertical: 13,
    paddingHorizontal: 12,
  },
  statLabel: { fontSize: 11.5, color: colors.dim, fontWeight: '600' },
  statValue: { fontSize: 19, fontWeight: '700', letterSpacing: -0.5, marginTop: 7 },
  statValueText: { fontSize: 17 },
  statSub: { fontSize: 11, marginTop: 3, fontWeight: '600' },
  cell: {
    flex: 1,
    backgroundColor: '#0a1020',
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  cellLabel: { fontSize: 10.5, color: colors.dim, fontWeight: '600', textAlign: 'center' },
  cellValue: { fontSize: 21, fontWeight: '800', letterSpacing: -0.8, marginTop: 5 },
  cellValueText: { fontSize: 15, paddingTop: 5 },
  cellSub: { fontSize: 10, marginTop: 2, fontWeight: '600', textAlign: 'center' },
});
