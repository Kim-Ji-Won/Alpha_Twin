// specs/components.md — StatusBadge (.badge/.chip)
// tone: accent|pos|neg|warn|neutral — color + translucent tint + border
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { alpha, colors } from '@/src/theme';
import { font } from '@/lib/fonts';

export type BadgeTone = 'accent' | 'pos' | 'neg' | 'warn' | 'neutral';

export interface StatusBadgeProps {
  label: string;
  tone: BadgeTone;
  size?: 'sm' | 'md';
  style?: ViewStyle;
}

const TONE: Record<BadgeTone, { color: string; bg: string; border: string }> = {
  accent: { color: colors.accent, bg: alpha.accent12, border: alpha.accentBorder },
  pos: { color: colors.pos, bg: alpha.pos15, border: 'rgba(52,211,153,0.30)' },
  neg: { color: colors.neg, bg: alpha.neg15, border: 'rgba(248,113,113,0.30)' },
  warn: { color: colors.warn, bg: alpha.warn15, border: alpha.warnBorder },
  neutral: { color: '#cdd7e8', bg: alpha.white05, border: colors.line },
};

export function StatusBadge({ label, tone, size = 'md', style }: StatusBadgeProps) {
  const t = TONE[tone];
  const sm = size === 'sm';
  return (
    <View
      accessibilityLabel={label}
      style={[
        styles.base,
        {
          backgroundColor: t.bg,
          borderColor: t.border,
          paddingVertical: sm ? 3 : 6,
          paddingHorizontal: sm ? 8 : 11,
        },
        style,
      ]}>
      <Text
        style={[
          styles.label,
          { color: t.color, fontSize: sm ? 10.5 : 12.5, fontFamily: font('body', '600') },
        ]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    borderRadius: 99,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  label: { fontWeight: '600' },
});
