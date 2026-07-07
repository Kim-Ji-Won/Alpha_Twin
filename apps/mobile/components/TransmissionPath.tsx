// 디자인 프레임 04 .path — 영향 전달 경로: 단계 칩 + 화살표, 마지막 단계는 방향색.
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { ScenarioResult } from '@/src/types';
import { directionColor } from '@/lib/direction';
import { font } from '@/lib/fonts';

export interface TransmissionPathProps {
  steps: ScenarioResult['transmissionPath'];
  style?: ViewStyle;
}

export function TransmissionPath({ steps, style }: TransmissionPathProps) {
  const a11y = steps.map(s => `${s.step}: ${s.effect}`).join(', ');
  return (
    <View style={[styles.wrap, style]} accessibilityLabel={`전달 경로 — ${a11y}`}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const color = last && s.direction !== 'neutral' ? directionColor(s.direction) : '#cdd7e8';
        const borderColor =
          last && s.direction !== 'neutral' ? `${directionColor(s.direction)}66` : colors.line;
        return (
          <React.Fragment key={`${s.step}-${i}`}>
            {i > 0 ? (
              <Text style={[styles.arrow, { fontFamily: font('mono', '500') }]}>→</Text>
            ) : null}
            <View style={[styles.node, { borderColor }]}>
              <Text style={[styles.nodeText, { color, fontFamily: font('body', '600') }]}>
                {s.step}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  node: {
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: 9,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  nodeText: { fontSize: 11, fontWeight: '600' },
  arrow: { fontSize: 12, color: colors.dim },
});
