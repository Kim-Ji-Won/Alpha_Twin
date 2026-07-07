// 디자인 .foot — 데이터 기준 시각·추정 범위 등 메타데이터 (mono 11px dim).
// 모든 분석 화면은 asOf를 표시해야 한다 (HANDOFF 규칙).
import React from 'react';
import { StyleSheet, Text, TextStyle } from 'react-native';
import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';

export interface DataMetadataProps {
  items: string[];
  style?: TextStyle;
}

export function formatAsOf(iso: string): string {
  // '2026-07-06T09:00:00+09:00' → '2026-07-06 09:00'
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : iso;
}

export function DataMetadata({ items, style }: DataMetadataProps) {
  return (
    <Text style={[styles.foot, { fontFamily: font('mono', '500') }, style]}>
      {items.join(' · ')}
    </Text>
  );
}

const styles = StyleSheet.create({
  foot: { fontSize: 11, lineHeight: 19, color: colors.dim, paddingHorizontal: 4 },
});
