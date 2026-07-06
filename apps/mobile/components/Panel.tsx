// specs/components.md — Panel (.panel/.alert/.warnpanel)
// variant: default | alert (amber border) | danger (red tint)
import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { alpha, colors, radius, spacing } from '@/src/theme';

export type PanelVariant = 'default' | 'alert' | 'danger';

export interface PanelProps {
  variant?: PanelVariant;
  children: React.ReactNode;
  style?: ViewStyle;
}

const VARIANT: Record<PanelVariant, ViewStyle> = {
  default: { backgroundColor: colors.panel, borderColor: colors.line },
  alert: { backgroundColor: alpha.warn15, borderColor: alpha.warnBorder },
  danger: { backgroundColor: alpha.neg15, borderColor: 'rgba(248,113,113,0.30)' },
};

export function Panel({ variant = 'default', children, style }: PanelProps) {
  return <View style={[styles.base, VARIANT[variant], style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.panel,
    borderWidth: 1,
    padding: spacing.panelPad,
  },
});
