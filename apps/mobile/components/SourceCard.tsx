// specs/components.md — SourceQuote (.qsrc): 좌측 컬러 보더 + 이탤릭 발췌 + 출처/날짜 mono.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { colors } from '@/src/theme';
import { EvidenceSource } from '@/src/types';
import { font } from '@/lib/fonts';

const KIND_META: Record<EvidenceSource['kind'], { label: string; color: string }> = {
  filing: { label: '재무 원문', color: colors.accent },
  transcript: { label: '경영진 발언', color: colors.accent2 },
  consensus: { label: '시장 추정', color: colors.warn },
  news: { label: '뉴스', color: colors.violet },
  flow: { label: '수급', color: colors.neutral },
};

export interface SourceCardProps {
  source: EvidenceSource;
  /** 경영진 발언 출처의 '발언–실적 일치도 기록 보기' 이동 */
  onOpenManagement?: () => void;
  style?: ViewStyle;
}

export function SourceCard({ source, onOpenManagement, style }: SourceCardProps) {
  const meta = KIND_META[source.kind];
  const [mockNote, setMockNote] = useState(false);
  const shortDate = source.date.slice(5).replace('-', '/');

  const openSource = async () => {
    if (source.url && /^https?:\/\//.test(source.url)) {
      try {
        await WebBrowser.openBrowserAsync(source.url);
        return;
      } catch {}
    }
    setMockNote(true); // 유효한 URL 없음 → Mock 출처 안내
  };

  return (
    <View
      style={[styles.card, { borderLeftColor: meta.color }, style]}
      accessibilityLabel={`출처: ${source.title}, ${source.date}. ${source.excerpt ?? ''}`}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: meta.color, fontFamily: font('mono', '600') }]}>
          {source.title}
        </Text>
        <Text style={[styles.date, { color: meta.color, fontFamily: font('mono', '600') }]}>
          {shortDate}
        </Text>
      </View>
      {source.excerpt ? (
        <Text style={[styles.excerpt, { fontFamily: font('body', '500') }]}>
          "{source.excerpt}"
        </Text>
      ) : null}
      <View style={styles.foot}>
        <Text style={[styles.footText, { fontFamily: font('mono', '500') }]}>
          근거 유형 · {meta.label}
          {source.caveat ? ` · ${source.caveat}` : ''}
        </Text>
        {source.kind === 'transcript' && onOpenManagement ? (
          <Pressable
            onPress={onOpenManagement}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="발언–실적 일치도 기록 보기">
            <Text style={[styles.action, { fontFamily: font('mono', '600') }]}>
              발언–실적 기록 보기 ↗
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={openSource}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="원문 열기">
            <Text style={[styles.action, { fontFamily: font('mono', '600') }]}>원문 열기 ↗</Text>
          </Pressable>
        )}
      </View>
      {mockNote ? (
        <Text style={[styles.mockNote, { fontFamily: font('mono', '500') }]}>
          현재는 Mock 출처입니다 — 실제 원문 연결은 P3에서 제공됩니다.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 2.5,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 10,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 6 },
  title: { fontSize: 11, fontWeight: '600', flexShrink: 1 },
  date: { fontSize: 11, fontWeight: '600' },
  excerpt: { fontSize: 12.5, lineHeight: 20, color: '#cdd7e8', fontStyle: 'italic' },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
    minHeight: 24,
  },
  footText: { fontSize: 11, color: colors.dim, flexShrink: 1 },
  action: { fontSize: 11, color: colors.accent },
  mockNote: { fontSize: 10.5, color: colors.warn, marginTop: 6 },
});
