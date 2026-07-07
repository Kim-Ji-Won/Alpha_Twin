// 논제 건강도 히어로 하단 근거 칩 — '긍정 근거 8' 등 (디자인 프레임 05 .chips)
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';

export type EvidenceTone = 'pos' | 'neg' | 'neutral';

const TONE: Record<EvidenceTone, { color: string; border: string }> = {
  pos: { color: colors.pos, border: 'rgba(52,211,153,0.3)' },
  neg: { color: colors.neg, border: 'rgba(248,113,113,0.3)' },
  neutral: { color: '#cdd7e8', border: colors.line },
};

export interface EvidenceCountChipProps {
  label: string;
  count: number;
  tone: EvidenceTone;
  style?: ViewStyle;
}

export function EvidenceCountChip({ label, count, tone, style }: EvidenceCountChipProps) {
  const t = TONE[tone];
  return (
    <View
      style={[styles.chip, { borderColor: t.border }, style]}
      accessibilityLabel={`${label} ${count}건`}>
      <Text style={[styles.text, { color: t.color, fontFamily: font('body', '600') }]}>
        {label} <Text style={{ fontFamily: font('mono', '600') }}>{count}</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: 99,
    paddingVertical: 6,
    paddingHorizontal: 11,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  text: { fontSize: 11.5, fontWeight: '600' },
});
