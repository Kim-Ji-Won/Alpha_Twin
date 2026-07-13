// 프레임 17 — 시스템·예외 상태 타일 (.stile): 아이콘 + 제목 + 설명 + 다음 행동.
// 공통 규칙: 불확실성을 숨기지 않고 표시 · 항상 다음 행동 제시.
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';

export type SystemStateTone = 'default' | 'accent' | 'warn' | 'neg';

const TONE_COLOR: Record<SystemStateTone, string> = {
  default: colors.mut,
  accent: colors.accent,
  warn: colors.warn,
  neg: colors.neg,
};

export interface SystemStateCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: SystemStateTone;
  /** 진행 바 표시 (데이터 수집 중 등) */
  progress?: boolean;
  style?: ViewStyle;
}

export function SystemStateCard({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  tone = 'default',
  progress = false,
  style,
}: SystemStateCardProps) {
  const color = TONE_COLOR[tone];
  return (
    <View
      style={[styles.card, tone === 'warn' && { borderColor: 'rgba(251,191,36,0.28)' }, style]}
      accessibilityLabel={`${title}: ${description}`}>
      <View style={styles.icon}>{icon}</View>
      <Text style={[styles.title, { fontFamily: font('body', '800') }]}>{title}</Text>
      <Text style={[styles.description, { fontFamily: font('body', '500') }]}>{description}</Text>
      {progress ? (
        <View style={styles.track}>
          <View style={styles.fill} />
        </View>
      ) : null}
      {actionLabel ? (
        <Pressable
          onPress={onAction}
          disabled={!onAction}
          hitSlop={8}
          accessibilityRole={onAction ? 'button' : undefined}
          accessibilityLabel={actionLabel}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Text style={[styles.action, { color: tone === 'default' ? colors.accent : color, fontFamily: font('body', '700') }]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    padding: 18,
    marginBottom: 12,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 14.5, fontWeight: '800', color: colors.ink, marginTop: 12 },
  description: { fontSize: 12.5, lineHeight: 20, color: colors.mut, marginTop: 6 },
  track: {
    height: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
    marginTop: 14,
  },
  fill: { width: '45%', height: '100%', borderRadius: 99, backgroundColor: colors.accent, opacity: 0.85 },
  action: { fontSize: 12, fontWeight: '700', marginTop: 12 },
});
