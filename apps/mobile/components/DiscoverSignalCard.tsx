// 프레임 08 — AI 이상 신호 행 (.evt + 추천 이유 라인).
// 개인화: 내 포트폴리오/논제와의 관련성을 하단에 표시.
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { DiscoverSignal } from '@/src/types';
import { font } from '@/lib/fonts';
import { StatusBadge } from '@/components/StatusBadge';
import { RichText } from '@/components/RichText';
import { Pulse } from '@/components/Pulse';

const TONE_COLOR: Record<DiscoverSignal['tone'], string> = {
  accent: colors.accent,
  warn: colors.warn,
  neg: colors.neg,
  pos: colors.pos,
};

export interface DiscoverSignalCardProps {
  signal: DiscoverSignal;
  onPress?: () => void;
  first?: boolean;
  style?: ViewStyle;
}

export function DiscoverSignalCard({ signal, onPress, first, style }: DiscoverSignalCardProps) {
  const color = TONE_COLOR[signal.tone];
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${signal.badge}: ${signal.title}. ${signal.detail} ${signal.recommendReason}`}
      style={({ pressed }) => [styles.row, first ? null : styles.divider, { opacity: pressed ? 0.75 : 1 }, style]}>
      <View style={[styles.stub, { backgroundColor: color }]} />
      <View style={styles.body}>
        <View style={styles.head}>
          <StatusBadge label={signal.badge} tone={signal.tone === 'accent' ? 'accent' : signal.tone === 'warn' ? 'warn' : signal.tone === 'neg' ? 'neg' : 'pos'} size="sm" />
          <Text style={[styles.sector, { fontFamily: font('mono', '500') }]}>{signal.sector}</Text>
        </View>
        <Text style={[styles.title, { fontFamily: font('body', '700') }]}>{signal.title}</Text>
        <Text style={[styles.detail, { fontFamily: font('body', '500') }]}>{signal.detail}</Text>
        <View style={styles.reason}>
          <Pulse minOpacity={0.35}><View style={[styles.dot, { backgroundColor: color }]} /></Pulse>
          <RichText
            text={signal.recommendReason}
            highlights={signal.recommendReasonHighlights ?? [{ text: '추천 이유', tone: 'strong' }]}
            style={[styles.reasonText, { color, fontFamily: font('mono', '500') }]}
          />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, paddingVertical: 11 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  stub: { width: 3, borderRadius: 3 },
  body: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sector: { fontSize: 10.5, color: colors.dim },
  title: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 6, lineHeight: 19 },
  detail: { fontSize: 12.5, lineHeight: 19, color: colors.mut, marginTop: 3 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  dot: { width: 5, height: 5, borderRadius: 99 },
  reasonText: { fontSize: 10.5, flexShrink: 1 },
});
