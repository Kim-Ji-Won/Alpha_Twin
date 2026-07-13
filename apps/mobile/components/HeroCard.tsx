// specs/components.md — HeroCard (.hero .tag)
// accent 그라디언트 틴트 + 22px radius. 화면당 1개만 사용.
// P2: tone='warn' — Portfolio X-Ray 숨은 위험 히어로 (프레임 06, amber 틴트)
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, radius, spacing } from '@/src/theme';
import { font } from '@/lib/fonts';

export type HeroTone = 'accent' | 'warn';

export interface HeroCardProps {
  tag: string;
  tone?: HeroTone;
  children: React.ReactNode;
  style?: ViewStyle;
}

const TONE: Record<HeroTone, { tint: string; border: string; text: string }> = {
  accent: { tint: colors.accent, border: 'rgba(34,211,238,0.22)', text: colors.accent },
  warn: { tint: colors.warn, border: 'rgba(251,191,36,0.30)', text: colors.warn },
};

export function HeroCard({ tag, tone = 'accent', children, style }: HeroCardProps) {
  const t = TONE[tone];
  return (
    <View style={[styles.base, { borderColor: t.border }, style]}>
      <Svg style={[StyleSheet.absoluteFill, { borderRadius: radius.hero }]} pointerEvents="none">
        <Defs>
          <LinearGradient id="heroTint" x1="0" y1="0" x2="0.7" y2="1">
            <Stop offset="0" stopColor={t.tint} stopOpacity={tone === 'warn' ? 0.12 : 0.14} />
            <Stop offset="0.55" stopColor={colors.accent2} stopOpacity="0.06" />
            <Stop offset="1" stopColor={colors.accent2} stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" rx={radius.hero} fill="url(#heroTint)" />
      </Svg>
      <Text
        style={[styles.tag, { color: t.text, fontFamily: font('body', '700') }]}
        accessibilityRole="header">
        {tag}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.hero,
    borderWidth: 1,
    padding: spacing.heroPad,
    marginBottom: spacing.gap,
    overflow: 'hidden',
  },
  tag: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
});
