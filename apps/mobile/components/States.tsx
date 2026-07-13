// 프레임 17 — 예외 상태 공통 컴포넌트: Loading / Error / Empty.
// 모든 화면의 useAsync 4-상태(loading/success/empty/error) 렌더에 사용.
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Circle, Polygon } from 'react-native-svg';
import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';
import { SecondaryButton } from '@/components/SecondaryButton';
import { Pulse } from '@/components/Pulse';

// ── LoadingState — 트윈 동기화 다이아몬드 펄스 + 단계 텍스트 ─────────────
export interface LoadingStateProps {
  stage?: string;
  style?: ViewStyle;
}

export function LoadingState({ stage = '디지털 트윈 동기화 중', style }: LoadingStateProps) {
  return (
    <View style={[styles.center, style]} accessibilityLabel={`로딩 중: ${stage}`}>
      <Pulse>
        <Svg width={60} height={60} viewBox="0 0 60 60">
          <Polygon points="30,6 54,30 30,54 6,30" fill="none" stroke={colors.accent} strokeWidth={2} />
          <Polygon points="30,14 46,30 30,48 14,30" fill={colors.accent2} opacity={0.4} />
          <Circle cx={30} cy={29} r={3.5} fill={colors.accent} />
        </Svg>
      </Pulse>
      <Text style={[styles.loadingText, { fontFamily: font('mono', '500') }]}>{stage}</Text>
    </View>
  );
}

// ── ErrorState — 실패 메시지 + 재시도 ────────────────────────────────────
export interface ErrorStateProps {
  message?: string;
  onRetry: () => void;
  /** '마지막 성공 결과 유지' 안내 (프레임 17) */
  lastGood?: string;
  style?: ViewStyle;
}

export function ErrorState({
  message = '데이터를 불러오지 못했습니다.',
  onRetry,
  lastGood,
  style,
}: ErrorStateProps) {
  return (
    <View style={[styles.center, style]}>
      <Text style={styles.errorIcon}>!</Text>
      <Text style={[styles.title, { fontFamily: font('body', '700') }]}>연결에 문제가 있어요</Text>
      <Text style={[styles.message, { fontFamily: font('body', '500') }]}>{message}</Text>
      {lastGood ? (
        <Text style={[styles.lastGood, { fontFamily: font('mono', '500') }]}>{lastGood}</Text>
      ) : null}
      <SecondaryButton label="다시 시도" onPress={onRetry} style={styles.action} />
    </View>
  );
}

// ── EmptyState — 빈 데이터 + 행동 유도 ───────────────────────────────────
export interface EmptyStateProps {
  icon?: string;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function EmptyState({ icon = '◇', title, message, actionLabel, onAction, style }: EmptyStateProps) {
  return (
    <View style={[styles.center, style]}>
      <Text style={[styles.emptyIcon, { fontFamily: font('mono', '500') }]}>{icon}</Text>
      <Text style={[styles.title, { fontFamily: font('body', '700') }]}>{title}</Text>
      <Text style={[styles.message, { fontFamily: font('body', '500') }]}>{message}</Text>
      {actionLabel && onAction ? (
        <SecondaryButton label={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 30 },
  loadingText: { fontSize: 11, color: colors.dim, marginTop: 16 },
  errorIcon: { fontSize: 26, color: colors.warn, fontWeight: '800', marginBottom: 10 },
  emptyIcon: { fontSize: 26, color: colors.dim, marginBottom: 10 },
  title: { fontSize: 16, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  message: { fontSize: 13.5, lineHeight: 21, color: colors.mut, textAlign: 'center', marginTop: 8 },
  lastGood: { fontSize: 11, color: colors.dim, marginTop: 10, textAlign: 'center' },
  action: { marginTop: 18, minWidth: 160 },
});
