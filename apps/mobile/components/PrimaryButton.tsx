// specs/components.md — PrimaryButton (.btnp)
// accent→accent2 gradient, text #03121b, radius 15, weight 700 13.5px
import React from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, radius } from '@/src/theme';
import { font } from '@/lib/fonts';

export interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** design variants: onboarding CTA uses radius 8, login email CTA uses 13 */
  borderRadius?: number;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  borderRadius = radius.button,
  style,
  accessibilityLabel,
}: PrimaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.base,
        { borderRadius, opacity: disabled ? 0.45 : pressed ? 0.85 : 1 },
        style,
      ]}>
      <Svg style={[StyleSheet.absoluteFill, { borderRadius }]} pointerEvents="none">
        <Defs>
          <LinearGradient id="pbtn" x1="0" y1="0" x2="1" y2="0.4">
            <Stop offset="0" stopColor={colors.accent} />
            <Stop offset="1" stopColor={colors.accent2} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" rx={borderRadius} fill="url(#pbtn)" />
      </Svg>
      <Text style={[styles.label, { fontFamily: font('body', '700') }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48, // ≥44pt touch target
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  label: {
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: -0.13,
    color: '#03121b',
  },
});
