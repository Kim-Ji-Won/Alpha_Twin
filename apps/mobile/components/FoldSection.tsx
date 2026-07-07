// specs/components.md — FoldRow (.fold .chev)
// 접힌 상태에도 핵심 수치 요약(summary)을 항상 노출한다.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '@/src/theme';
import { font } from '@/lib/fonts';

export interface FoldSectionProps {
  title: string;
  /** 접힘/펼침과 무관하게 항상 보이는 핵심 요약 (텍스트 또는 커스텀 노드) */
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  /** 마지막 fold는 하단 구분선 추가 (디자인 프레임 01) */
  bottomLine?: boolean;
  style?: ViewStyle;
}

export function FoldSection({
  title,
  summary,
  children,
  defaultExpanded = false,
  bottomLine = false,
  style,
}: FoldSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <View style={[bottomLine && styles.bottomLine, style]}>
      <Pressable
        onPress={() => setExpanded(v => !v)}
        accessibilityRole="button"
        accessibilityLabel={`${title} 섹션 ${expanded ? '접기' : '펼치기'}`}
        accessibilityState={{ expanded }}
        style={styles.header}>
        <Text style={[styles.title, { fontFamily: font('body', '700') }]}>{title}</Text>
        <View style={styles.summaryWrap}>
          {typeof summary === 'string' ? (
            <Text style={[styles.summaryText, { fontFamily: font('mono', '600') }]}>{summary}</Text>
          ) : (
            summary
          )}
          <View style={[styles.chev, expanded && styles.chevOpen]}>
            <Svg width={12} height={12} viewBox="0 0 12 12">
              <Path
                d="M2.5 4.5L6 8l3.5-3.5"
                stroke={colors.dim}
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </View>
        </View>
      </Pressable>
      {expanded ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 2,
    minHeight: 52,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  bottomLine: { borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontSize: 14.5, fontWeight: '700', color: '#dbe4f2' },
  summaryWrap: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 },
  summaryText: { fontSize: 11.5, color: colors.dim, fontWeight: '600' },
  chev: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevOpen: { transform: [{ rotate: '180deg' }] },
  content: { paddingHorizontal: 2, paddingBottom: 12 },
});
