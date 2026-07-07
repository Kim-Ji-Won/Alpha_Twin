// specs/components.md — CheckItem (.check .ckic)
// ✓(pos) / !(warn) / ?(dim) / ×(neg) 원형 아이콘 + 제목 + 근거 노트.
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { ThesisHypothesis } from '@/src/types';
import { font } from '@/lib/fonts';

type Status = ThesisHypothesis['status'];

const STATUS: Record<Status, { icon: string; color: string; bg: string; label: string }> = {
  confirmed: { icon: '✓', color: colors.pos, bg: 'rgba(52,211,153,0.16)', label: '확인됨' },
  watch: { icon: '!', color: colors.warn, bg: 'rgba(251,191,36,0.16)', label: '주의' },
  unverified: { icon: '?', color: colors.dim, bg: 'rgba(255,255,255,0.08)', label: '미확인' },
  broken: { icon: '×', color: colors.neg, bg: 'rgba(248,113,113,0.16)', label: '약화됨' },
};

export interface CheckItemProps {
  status: Status;
  title: string;
  note?: string;
  /** 아이콘 대신 표시할 문자 (작성 미리보기의 번호 등) */
  iconOverride?: string;
  first?: boolean;
  /** 우측 액션 슬롯 (편집 화면의 삭제 버튼 등) */
  right?: React.ReactNode;
  style?: ViewStyle;
}

export function CheckItem({ status, title, note, iconOverride, first, right, style }: CheckItemProps) {
  const s = STATUS[status];
  return (
    <View
      style={[styles.row, first ? null : styles.divider, style]}
      accessibilityLabel={`${s.label}: ${title}${note ? `. ${note}` : ''}`}>
      <View style={[styles.icon, { backgroundColor: s.bg }]}>
        <Text style={[styles.iconText, { color: s.color, fontFamily: font('mono', '700') }]}>
          {iconOverride ?? s.icon}
        </Text>
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { fontFamily: font('body', '700') }]}>{title}</Text>
        {note ? <Text style={[styles.note, { fontFamily: font('body', '500') }]}>{note}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
    alignItems: 'flex-start',
    minHeight: 40,
  },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  icon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  iconText: { fontSize: 10, fontWeight: '800' },
  body: { flex: 1 },
  title: { fontSize: 13.5, fontWeight: '700', color: colors.ink, lineHeight: 19 },
  note: { fontSize: 12.5, color: colors.mut, lineHeight: 18, marginTop: 2 },
});
