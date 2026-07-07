// specs/components.md — EventTimeline 행 (.evt .stub)
// 좌측 컬러 스텁 + 배지 + 제목 + 영향 경로 + 출처. 탭 → Company Twin 등 이동.
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { CompanyEvent } from '@/src/types';
import { StatusBadge, BadgeTone } from '@/components/StatusBadge';
import { font } from '@/lib/fonts';

const KIND_LABEL: Record<CompanyEvent['kind'], string> = {
  filing: '공시',
  news: '뉴스',
  earnings: '실적',
  contract: '수주',
  management: '경영진',
  macro: '거시',
};

const SEVERITY_LABEL: Record<CompanyEvent['severity'], string> = {
  high: '중요도 상',
  medium: '주의',
  low: '참고',
};

function toneOf(e: CompanyEvent): { badge: BadgeTone; stub: string } {
  if (e.direction === 'positive') return { badge: 'accent', stub: colors.accent };
  if (e.direction === 'negative')
    return e.severity === 'high' ? { badge: 'neg', stub: colors.neg } : { badge: 'warn', stub: colors.warn };
  if (e.direction === 'mixed') return { badge: 'warn', stub: colors.warn };
  return { badge: 'neutral', stub: colors.neutral };
}

export interface EventRowProps {
  event: CompanyEvent;
  /** 우측 상단 meta (시각 등). 없으면 date의 시간/일자 사용 */
  meta?: string;
  onPress?: () => void;
  /** 리스트 첫 행은 상단 구분선 없음 */
  first?: boolean;
  showSource?: boolean;
  style?: ViewStyle;
}

function defaultMeta(date: string): string {
  // '2026-07-06T08:30:00+09:00' → '08:30' · '2026-06-27' → '06/27'
  const t = date.match(/T(\d{2}:\d{2})/);
  if (t) return t[1];
  const d = date.match(/\d{4}-(\d{2})-(\d{2})/);
  return d ? `${d[1]}/${d[2]}` : date;
}

export function EventRow({ event, meta, onPress, first, showSource = false, style }: EventRowProps) {
  const tone = toneOf(event);
  const badgeLabel = `${KIND_LABEL[event.kind]} · ${SEVERITY_LABEL[event.severity]}`;
  const body = (
    <>
      <View style={[styles.stub, { backgroundColor: tone.stub }]} />
      <View style={styles.content}>
        <View style={styles.head}>
          <StatusBadge label={badgeLabel} tone={tone.badge} size="sm" />
          <Text style={[styles.meta, { fontFamily: font('mono', '500') }]}>
            {meta ?? defaultMeta(event.date)}
          </Text>
        </View>
        <Text style={[styles.title, { fontFamily: font('body', '700') }]}>{event.title}</Text>
        <Text style={[styles.impact, { fontFamily: font('body', '500') }]}>{event.impactPath}</Text>
        {showSource ? (
          <Text style={[styles.source, { fontFamily: font('mono', '500') }]}>
            {event.source.title} · {event.source.date}
            {event.source.caveat ? ` · ${event.source.caveat}` : ''}
          </Text>
        ) : null}
      </View>
    </>
  );
  const rowStyle = [styles.row, first ? null : styles.divider, style];
  if (!onPress) return <View style={rowStyle}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${badgeLabel}, ${event.title}`}
      style={({ pressed }) => [...rowStyle, { opacity: pressed ? 0.75 : 1 }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, paddingVertical: 11, minHeight: 56 },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  stub: { width: 3, borderRadius: 3 },
  content: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  meta: { fontSize: 11, color: colors.dim },
  title: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 5, lineHeight: 19 },
  impact: { fontSize: 12.5, color: colors.mut, lineHeight: 19, marginTop: 3 },
  source: { fontSize: 11, color: colors.dim, marginTop: 6 },
});
