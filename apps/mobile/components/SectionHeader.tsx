// specs/components.md — SectionHeader (.ohd/.pt)
// 11.5px uppercase +1.2 letterSpacing dim · optional right-side meta (mono)
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, type } from '@/src/theme';
import { font } from '@/lib/fonts';

export interface SectionHeaderProps {
  label: string;
  meta?: string;
  style?: ViewStyle;
}

export function SectionHeader({ label, meta, style }: SectionHeaderProps) {
  return (
    <View style={[styles.row, style]}>
      <Text
        style={[styles.label, { fontFamily: font('body', '700') }]}
        accessibilityRole="header">
        {label}
      </Text>
      {meta ? (
        <Text style={[styles.meta, { fontFamily: font('mono', '500') }]}>{meta}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  label: {
    fontSize: type.section.size,
    letterSpacing: type.section.letterSpacing,
    textTransform: 'uppercase',
    color: colors.dim,
    fontWeight: '700',
  },
  meta: { fontSize: 10.5, color: colors.dim },
});
