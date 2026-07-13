// specs/components.md — ConclusionPanel: HeroCard 변형.
// Scenario 결과 화면 최상단 필수 ('AI 핵심 결론').
import React from 'react';
import { StyleSheet, ViewStyle } from 'react-native';
import { HeroCard } from '@/components/HeroCard';
import { font } from '@/lib/fonts';
import { RichText } from '@/components/RichText';
import { Highlight } from '@/src/types';

export interface ConclusionPanelProps {
  tag?: string;
  text: string;
  highlights?: Highlight[];
  style?: ViewStyle;
}

export function ConclusionPanel({ tag = 'AI 핵심 결론 · CONCLUSION', text, highlights, style }: ConclusionPanelProps) {
  return (
    <HeroCard tag={tag} style={style}>
      <RichText text={text} highlights={highlights} style={[styles.text, { fontFamily: font('body', '600') }]} />
    </HeroCard>
  );
}

const styles = StyleSheet.create({
  text: {
    marginTop: 9,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
    color: '#e2e9f5',
  },
});
