// 프레임 25 — 토글 설정 행 (.setrow + .tgl): 44×26 커스텀 토글, accent on.
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';
import { StatusBadge } from '@/components/StatusBadge';

export interface ToggleSettingRowProps {
  title: string;
  sub?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  /** '우선' 등 제목 옆 배지 */
  badge?: string;
  disabled?: boolean;
  first?: boolean;
  style?: ViewStyle;
}

export function ToggleSettingRow({
  title,
  sub,
  value,
  onChange,
  badge,
  disabled,
  first,
  style,
}: ToggleSettingRowProps) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={`${title}${sub ? `. ${sub}` : ''}`}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.row,
        first ? null : styles.divider,
        { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { fontFamily: font('body', '600') }]}>{title}</Text>
          {badge ? <StatusBadge label={badge} tone="warn" size="sm" /> : null}
        </View>
        {sub ? <Text style={[styles.sub, { fontFamily: font('body', '500') }]}>{sub}</Text> : null}
      </View>
      <View style={[styles.track, value && styles.trackOn]}>
        <View style={[styles.knob, value && styles.knobOn]} />
      </View>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '600', color: '#dbe4f2' },
  sub: { fontSize: 12, lineHeight: 18, color: colors.dim, marginTop: 3 },
  track: {
    width: 44,
    height: 26,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    padding: 3,
  },
  trackOn: { backgroundColor: 'rgba(34,211,238,0.35)' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#8b99b4' },
  knobOn: { alignSelf: 'flex-end', backgroundColor: colors.accent },
});
