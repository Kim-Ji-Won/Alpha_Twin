// 디자인 프레임 04 .cmp — 시나리오 전후 비교 한 행: 라벨 / 전 → 후 + 변화량.
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { ScenarioDelta } from '@/src/types';
import { directionColor, directionSymbol, signed } from '@/lib/direction';
import { font } from '@/lib/fonts';

export interface BeforeAfterRowProps {
  delta: ScenarioDelta;
  first?: boolean;
  style?: ViewStyle;
}

function deltaText(d: ScenarioDelta): string {
  if (typeof d.before === 'number' && typeof d.after === 'number') {
    return signed(d.after - d.before);
  }
  const pctPair = String(d.before).match(/^(-?\d+(?:\.\d+)?)%$/) &&
    String(d.after).match(/^(-?\d+(?:\.\d+)?)%$/);
  if (pctPair) {
    return signed(parseFloat(String(d.after)) - parseFloat(String(d.before)), '%p');
  }
  const symbol = directionSymbol(d.direction);
  const word =
    d.direction === 'negative' ? '상승' : d.direction === 'positive' ? '개선' : '변화';
  // 위험도 '보통 → 높음'처럼 텍스트 값 — 방향 기호 + 단어
  return symbol ? `${symbol} ${word}` : word;
}

export function BeforeAfterRow({ delta, first, style }: BeforeAfterRowProps) {
  const color = delta.direction === 'neutral' ? colors.mut : directionColor(delta.direction);
  const textValue = typeof delta.after === 'string' && !/[%\d]/.test(delta.after);
  return (
    <View
      style={[styles.row, first ? null : styles.divider, style]}
      accessibilityLabel={`${delta.label}: ${delta.before}에서 ${delta.after}로 ${deltaText(delta)}`}>
      <Text style={[styles.label, { fontFamily: font('body', '600') }]}>{delta.label}</Text>
      <View style={styles.values}>
        <Text style={[styles.before, { fontFamily: font('mono', '700') }]}>{String(delta.before)}</Text>
        <Text style={[styles.arrow, { fontFamily: font('mono', '500') }]}>→</Text>
        <View style={styles.after}>
          <Text
            style={[
              styles.afterValue,
              textValue && styles.afterValueText,
              { color, fontFamily: font(textValue ? 'body' : 'mono', '800') },
            ]}>
            {String(delta.after)}
          </Text>
          <Text style={[styles.deltaText, { color, fontFamily: font('mono', '700') }]}>
            {deltaText(delta)}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 10 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  label: { fontSize: 11, color: colors.dim, fontWeight: '600', marginBottom: 4 },
  values: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  before: { flex: 1, fontSize: 17, fontWeight: '700', color: colors.mut },
  arrow: { fontSize: 15, color: colors.dim },
  after: { flex: 1, alignItems: 'flex-end' },
  afterValue: { fontSize: 19, fontWeight: '800' },
  afterValueText: { fontSize: 16 },
  deltaText: { fontSize: 10.5, fontWeight: '700', marginTop: 2 },
});
