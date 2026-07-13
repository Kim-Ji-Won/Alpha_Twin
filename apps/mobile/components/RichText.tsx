// P3-A — 문장 내 키워드 강조.
// 디자인 규칙: 본문 내 강조는 <b ink> 또는 상태색 굵게 (design HTML의 <b style="color:...">).
// 색은 디자인 토큰만 사용, 과도한 색상 금지. 문장은 통짜 Text라 줄바꿈·접근성 낭독 자연스러움.
import React from 'react';
import { StyleSheet, Text, TextStyle } from 'react-native';
import { colors } from '@/src/theme';
import { Highlight, HighlightTone } from '@/src/types';
import { font } from '@/lib/fonts';

const TONE_COLOR: Record<HighlightTone, string> = {
  strong: colors.ink,       // 흰색 굵게 — 디자인의 <b style="color:var(--ink)">
  accent: colors.accent,
  positive: colors.pos,
  negative: colors.neg,
  warning: colors.warn,
};

export interface RichTextProps {
  text: string;
  highlights?: Highlight[];
  /** 기본 본문 스타일 (색·크기·행간) */
  style?: TextStyle | TextStyle[];
}

type Segment = { text: string; tone?: HighlightTone };

function splitByHighlights(text: string, highlights: Highlight[]): Segment[] {
  let segments: Segment[] = [{ text }];
  for (const h of highlights) {
    if (!h.text) continue;
    const next: Segment[] = [];
    for (const seg of segments) {
      if (seg.tone != null) {
        next.push(seg); // 이미 강조된 구간은 다시 쪼개지 않음
        continue;
      }
      const parts = seg.text.split(h.text);
      parts.forEach((part, i) => {
        if (part) next.push({ text: part });
        if (i < parts.length - 1) next.push({ text: h.text, tone: h.tone });
      });
    }
    segments = next;
  }
  return segments;
}

export function RichText({ text, highlights = [], style }: RichTextProps) {
  if (highlights.length === 0) {
    return <Text style={style}>{text}</Text>;
  }
  const segments = splitByHighlights(text, highlights);
  return (
    <Text style={style} accessibilityLabel={text}>
      {segments.map((seg, i) =>
        seg.tone ? (
          <Text
            key={i}
            style={[styles.highlight, { color: TONE_COLOR[seg.tone], fontFamily: font('body', '700') }]}>
            {seg.text}
          </Text>
        ) : (
          <Text key={i}>{seg.text}</Text>
        ),
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  highlight: { fontWeight: '700' },
});
