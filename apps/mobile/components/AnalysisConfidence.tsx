// 디자인 .conf — 라벨 + 그라디언트 바 + mono 퍼센트 (국면 신뢰도 / 환율 노출 등).
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { chartColors, colors } from '@/src/theme';
import { font } from '@/lib/fonts';

export interface AnalysisConfidenceProps {
  label: string;
  /** 0..1 */
  pct: number;
  /** 우측 값 텍스트 (기본: 퍼센트) */
  valueText?: string;
  /** 바 그라디언트 [시작, 끝] — 기본 accent→accent2 */
  gradient?: readonly [string, string];
  /** 값 텍스트 색 — 기본 accent */
  valueColor?: string;
  style?: ViewStyle;
}

export function AnalysisConfidence({
  label,
  pct,
  valueText,
  gradient = chartColors.gradient,
  valueColor = colors.accent,
  style,
}: AnalysisConfidenceProps) {
  const clamped = Math.max(0, Math.min(1, pct));
  const text = valueText ?? `${Math.round(clamped * 100)}%`;
  return (
    <View style={[styles.row, style]} accessibilityLabel={`${label} ${text}`}>
      <Text style={[styles.label, { fontFamily: font('mono', '500') }]}>{label}</Text>
      <View style={styles.track}>
        <View style={[styles.fillClip, { width: `${clamped * 100}%` }]}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="confGrad" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={gradient[0]} />
                <Stop offset="1" stopColor={gradient[1]} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" rx={3} fill="url(#confGrad)" />
          </Svg>
        </View>
      </View>
      <Text style={[styles.value, { color: valueColor, fontFamily: font('mono', '600') }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  label: { fontSize: 11, color: colors.mut },
  track: {
    flex: 1,
    height: 6,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  fillClip: { height: '100%', borderRadius: 99, overflow: 'hidden' },
  value: { fontSize: 12, fontWeight: '600' },
});
