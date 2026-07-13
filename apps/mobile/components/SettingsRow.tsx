// 프레임 25 — 설정 행 (.setrow): 제목/설명 + 우측 값 또는 화살표.
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';

export interface SettingsRowProps {
  title: string;
  sub?: string;
  /** 우측 값 텍스트 (accent) — 없으면 화살표 › */
  value?: string;
  onPress?: () => void;
  /** 로그아웃 등 — 흐린 색으로 */
  muted?: boolean;
  first?: boolean;
  right?: React.ReactNode;
  style?: ViewStyle;
}

export function SettingsRow({ title, sub, value, onPress, muted, first, right, style }: SettingsRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${title}${value ? `: ${value}` : ''}${sub ? `. ${sub}` : ''}`}
      style={({ pressed }) => [styles.row, first ? null : styles.divider, { opacity: pressed ? 0.7 : 1 }, style]}>
      <View style={styles.body}>
        <Text
          style={[styles.title, muted && { color: colors.dim }, { fontFamily: font('body', '600') }]}>
          {title}
        </Text>
        {sub ? (
          <Text style={[styles.sub, { fontFamily: font('body', '500') }]}>{sub}</Text>
        ) : null}
      </View>
      {right ??
        (value ? (
          <Text style={[styles.value, { fontFamily: font('mono', '600') }]}>{value} ▾</Text>
        ) : onPress ? (
          <Text style={[styles.arrow, { fontFamily: font('mono', '500') }]}>›</Text>
        ) : null)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 2,
    minHeight: 52,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  body: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600', color: '#dbe4f2' },
  sub: { fontSize: 12, lineHeight: 18, color: colors.dim, marginTop: 3 },
  value: { fontSize: 11.5, color: colors.accent },
  arrow: { fontSize: 17, color: colors.dim },
});
