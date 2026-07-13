// 프레임 09 — 알림 카드: 충돌(alert 패널·논제 영향 배지) 우선, 유형별 톤.
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { alpha, colors } from '@/src/theme';
import { AppNotification } from '@/src/types';
import { font } from '@/lib/fonts';
import { signed } from '@/lib/direction';
import { RichText } from '@/components/RichText';

const KIND_META: Record<
  AppNotification['kind'],
  { label: string; symbol: string; color: string; alert: boolean }
> = {
  contradiction: { label: '논제 충돌', symbol: '◆', color: colors.warn, alert: true },
  reinforcement: { label: '논제 강화', symbol: '▲', color: colors.pos, alert: false },
  event: { label: '이벤트', symbol: '●', color: '#cdd7e8', alert: false },
  regime: { label: '시장 · 국면 변화 감시', symbol: '◎', color: '#cdd7e8', alert: false },
  risk: { label: '위험 경고', symbol: '!', color: colors.neg, alert: true },
  data: { label: '데이터 업데이트', symbol: '↺', color: colors.dim, alert: false },
};

export interface NotificationCardProps {
  notification: AppNotification;
  /** 알림 제목 우측에 붙는 종목명 */
  stockName?: string;
  onPress?: () => void;
  style?: ViewStyle;
}

function timeText(iso: string): string {
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : iso;
}

export function NotificationCard({ notification: n, stockName, onPress, style }: NotificationCardProps) {
  const meta = KIND_META[n.kind];
  const title = `${meta.symbol} ${meta.label}${stockName ? ` · ${stockName}` : ''}`;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${meta.label} 알림${n.read ? '' : ', 읽지 않음'}: ${n.headline}`}
      style={({ pressed }) => [
        styles.card,
        meta.alert && styles.alert,
        { opacity: pressed ? 0.8 : 1 },
        style,
      ]}>
      <View style={styles.head}>
        <View style={styles.titleWrap}>
          {!n.read ? <View style={styles.unreadDot} /> : null}
          <Text style={[styles.title, { color: meta.color, fontFamily: font('body', '700') }]}>
            {title}
          </Text>
        </View>
        <Text style={[styles.time, { fontFamily: font('mono', '500') }]}>{timeText(n.time)}</Text>
      </View>
      <Text
        style={[
          styles.headline,
          meta.alert && { color: colors.ink, fontWeight: '700' },
          { fontFamily: font('body', meta.alert ? '700' : '500') },
        ]}>
        {n.headline}
      </Text>
      {n.detail ? (
        <RichText
          text={n.detail}
          highlights={n.detailHighlights ?? [{ text: '확인하세요', tone: 'strong' }]}
          style={[styles.detail, { fontFamily: font('body', '500') }]}
        />
      ) : null}
      {n.sources || n.thesisImpact != null || n.evidenceCount != null ? (
        <View style={styles.foot}>
          <Text style={[styles.sources, { fontFamily: font('mono', '500') }]} numberOfLines={1}>
            {n.sources ?? (n.evidenceCount != null ? `관련 근거 ${n.evidenceCount}건` : '')}
          </Text>
          {n.thesisImpact != null ? (
            <View style={styles.impactChip}>
              <Text style={[styles.impactText, { fontFamily: font('mono', '600') }]}>
                논제 영향 {signed(n.thesisImpact)}
              </Text>
            </View>
          ) : n.kind === 'contradiction' ? (
            <View style={styles.impactChip}>
              <Text style={[styles.impactText, { fontFamily: font('mono', '600') }]}>확인 권장</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    padding: 15,
    marginBottom: 14,
  },
  alert: { borderColor: alpha.warnBorder, backgroundColor: alpha.warn15 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  unreadDot: { width: 6, height: 6, borderRadius: 99, backgroundColor: colors.accent },
  title: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  time: { fontSize: 10, color: colors.dim },
  headline: { fontSize: 13.5, lineHeight: 21, color: '#b8c4da', marginTop: 9 },
  detail: { fontSize: 13, lineHeight: 20, color: colors.mut, marginTop: 7 },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 11,
  },
  sources: { fontSize: 10.5, color: colors.dim, flexShrink: 1 },
  impactChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 99,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  impactText: { fontSize: 10.5, color: '#cdd7e8' },
});
