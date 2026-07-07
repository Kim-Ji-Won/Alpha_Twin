// specs/components.md — VersionTimeline (.vtl .vte)
// 세로선 + 변화 방향 색 도트 + 날짜/제목/사유. 논제 변경 기록 화면용.
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { ThesisChange } from '@/src/types';
import { font } from '@/lib/fonts';
import { signed } from '@/lib/direction';

const KIND_LABEL: Record<ThesisChange['kind'], string> = {
  auto: '자동 감시',
  user_edit: '사용자 수정',
  created: '논제 생성',
};

export function changeDotColor(change: ThesisChange): string {
  if (change.kind === 'user_edit') return colors.warn;
  if (change.kind === 'created') return colors.accent;
  if (change.scoreBefore != null && change.scoreAfter != null) {
    return change.scoreAfter >= change.scoreBefore ? colors.pos : colors.neg;
  }
  return colors.neutral;
}

function changeTitle(change: ThesisChange): { text: string; deltaText?: string; deltaColor?: string } {
  if (change.scoreBefore != null && change.scoreAfter != null) {
    const delta = change.scoreAfter - change.scoreBefore;
    return {
      text: `건강도 ${change.scoreBefore} → ${change.scoreAfter}`,
      deltaText: signed(delta),
      deltaColor: delta >= 0 ? colors.pos : colors.neg,
    };
  }
  if (change.kind === 'created') return { text: '최초 작성' };
  return { text: '논제 수정' };
}

function shortDate(date: string): string {
  const m = date.match(/\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}` : date;
}

export interface VersionTimelineProps {
  changes: ThesisChange[];
  /** 오늘 날짜(YYYY-MM-DD) — 첫 항목에 '오늘' 표기 */
  today?: string;
  style?: ViewStyle;
}

export function VersionTimeline({ changes, today, style }: VersionTimelineProps) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.line} />
      {changes.map((c, i) => {
        const title = changeTitle(c);
        const isToday = today != null && c.date === today;
        return (
          <View
            key={`${c.date}-${i}`}
            style={[styles.entry, i === changes.length - 1 && styles.entryLast]}
            accessibilityLabel={`${shortDate(c.date)} ${KIND_LABEL[c.kind]}: ${title.text}. ${c.reason}`}>
            <View style={[styles.dot, { borderColor: changeDotColor(c) }]} />
            <Text style={[styles.date, { fontFamily: font('mono', '600') }]}>
              {shortDate(c.date)}
              {isToday ? ' · 오늘' : ''} · {KIND_LABEL[c.kind]}
            </Text>
            <Text style={[styles.title, { fontFamily: font('body', '700') }]}>
              {title.text}
              {title.deltaText ? (
                <Text style={{ color: title.deltaColor, fontFamily: font('mono', '700'), fontSize: 12 }}>
                  {'  '}
                  {title.deltaText}
                </Text>
              ) : null}
            </Text>
            <Text style={[styles.reason, { fontFamily: font('body', '500') }]}>{c.reason}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', paddingLeft: 22, paddingHorizontal: 2 },
  line: {
    position: 'absolute',
    left: 5,
    top: 6,
    bottom: 6,
    width: 1,
    backgroundColor: colors.line,
  },
  entry: { paddingBottom: 20 },
  entryLast: { paddingBottom: 0 },
  dot: {
    position: 'absolute',
    left: -22,
    top: 3,
    width: 11,
    height: 11,
    borderRadius: 99,
    borderWidth: 2,
    borderColor: colors.neutral,
    backgroundColor: colors.bg,
  },
  date: { fontSize: 11, color: colors.dim, fontWeight: '600' },
  title: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 4 },
  reason: { fontSize: 12.5, lineHeight: 19, color: colors.mut, marginTop: 4 },
});
