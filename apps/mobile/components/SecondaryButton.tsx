// specs/components.md — SecondaryButton (.btng): panel bg + border
import React from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, radius } from '@/src/theme';
import { font } from '@/lib/fonts';

export interface SecondaryButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
  style,
  accessibilityLabel,
}: SecondaryButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.base,
        { opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}>
      <Text style={[styles.label, { fontFamily: font('body', '700') }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.button,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: -0.13,
    color: '#cdd7e8',
  },
});
