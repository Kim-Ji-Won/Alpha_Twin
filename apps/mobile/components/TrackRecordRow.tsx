// 프레임 15 — 목표 달성 기록 행 (.trow .stag): 상태 태그 + 목표 + 분기 노트.
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { ManagementCommitment } from '@/src/types';
import { font } from '@/lib/fonts';

const STATUS: Record<ManagementCommitment['status'], { label: string; color: string; bg: string }> = {
  achieved: { label: '달성', color: colors.pos, bg: 'rgba(52,211,153,0.14)' },
  delayed: { label: '지연', color: colors.warn, bg: 'rgba(251,191,36,0.14)' },
  withdrawn: { label: '철회', color: colors.neg, bg: 'rgba(248,113,113,0.14)' },
};

export interface TrackRecordRowProps {
  commitment: ManagementCommitment;
  first?: boolean;
  style?: ViewStyle;
}

export function TrackRecordRow({ commitment, first, style }: TrackRecordRowProps) {
  const s = STATUS[commitment.status];
  const detail = [
    commitment.announcedQ ? `발표 ${commitment.announcedQ}` : null,
    commitment.resultQ ? `결과 ${commitment.resultQ}` : null,
    commitment.source ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View
      style={[styles.row, first ? null : styles.divider, style]}
      accessibilityLabel={`${s.label}: ${commitment.text}, ${commitment.note}${detail ? `. ${detail}` : ''}`}>
      <View style={[styles.tag, { backgroundColor: s.bg }]}>
        <Text style={[styles.tagText, { color: s.color, fontFamily: font('body', '800') }]}>
          {s.label}
        </Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { fontFamily: font('body', '600') }]}>{commitment.text}</Text>
        {detail ? (
          <Text style={[styles.detail, { fontFamily: font('mono', '500') }]}>{detail}</Text>
        ) : null}
      </View>
      <Text style={[styles.note, { fontFamily: font('mono', '500') }]}>{commitment.note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    minHeight: 44,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  tag: {
    width: 52,
    paddingVertical: 4,
    borderRadius: 6,
    alignItems: 'center',
  },
  tagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  body: { flex: 1 },
  title: { fontSize: 13.5, color: '#cdd7e8', fontWeight: '600', lineHeight: 19 },
  detail: { fontSize: 10, color: colors.dim, marginTop: 3 },
  note: { fontSize: 11.5, color: colors.dim },
});
