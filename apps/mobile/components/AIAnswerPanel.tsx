// 프레임 07 — AI 답변 말풍선 (.bub .buba + .ansec):
// 핵심 결론(굵게) + 핵심 근거 + 반대 가능성 + 데이터 근거 + 근거 확인 칩 행.
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors } from '@/src/theme';
import { AIAnalysis } from '@/src/types';
import { directionColor, directionSymbol } from '@/lib/direction';
import { font } from '@/lib/fonts';
import { StatusBadge } from '@/components/StatusBadge';
import { RichText } from '@/components/RichText';

const CONFIDENCE_TEXT: Record<'high' | 'medium' | 'low', string> = {
  high: '신뢰도 높음',
  medium: '신뢰도 보통',
  low: '신뢰도 낮음',
};

export interface AIAnswerPanelProps {
  analysis: AIAnalysis;
  /** '근거 N건' 칩 → 근거 상세 화면 */
  onOpenEvidence: () => void;
  style?: ViewStyle;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { fontFamily: font('body', '700') }]}>{title}</Text>
      {children}
    </View>
  );
}

export function AIAnswerPanel({ analysis, onOpenEvidence, style }: AIAnswerPanelProps) {
  const ev = analysis.evidence;
  const counterCount = analysis.dataPoints.filter(d => d.direction === 'negative').length || 1;
  const asOfShort = ev.asOf.slice(5, 10).replace('-', '/');
  const sourceLine = ev.sources.map(s => s.title.split('·')[0].trim()).join(' · ');

  return (
    <View style={[styles.bubble, style]} accessibilityLabel={`AI 답변: ${analysis.conclusion}`}>
      <RichText
        text={analysis.conclusion}
        highlights={analysis.conclusionHighlights}
        style={[styles.conclusion, { fontFamily: font('body', '800') }]}
      />

      <Section title="핵심 근거">
        <Text style={[styles.body, { fontFamily: font('body', '500') }]}>{analysis.keyReasons}</Text>
      </Section>

      <Section title="반대 가능성">
        <Text style={[styles.body, { fontFamily: font('body', '500') }]}>{analysis.counterCase}</Text>
      </Section>

      <Section title="데이터 근거">
        {analysis.dataPoints.map(d => (
          <View key={d.label} style={styles.kv} accessibilityLabel={`${d.label} ${d.value}`}>
            <Text style={[styles.kvLabel, { fontFamily: font('body', '600') }]}>{d.label}</Text>
            <Text
              style={[
                styles.kvValue,
                { color: directionColor(d.direction), fontFamily: font('mono', '600') },
              ]}>
              {d.value}
              {directionSymbol(d.direction) ? ` ${directionSymbol(d.direction)}` : ''}
            </Text>
          </View>
        ))}
      </Section>

      <Section title="근거 확인 · Evidence">
        <View style={styles.chips}>
          <Pressable
            onPress={onOpenEvidence}
            accessibilityRole="button"
            accessibilityLabel={`근거 ${ev.sources.length}건 상세 보기`}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <StatusBadge label={`근거 ${ev.sources.length}건 ↗`} tone="accent" />
          </Pressable>
          <StatusBadge label={`데이터 기준 ${asOfShort}`} tone="neutral" />
          <StatusBadge label={`반대 근거 ${counterCount}건`} tone="neg" />
          <StatusBadge label={CONFIDENCE_TEXT[ev.confidence.level]} tone={ev.confidence.level === 'high' ? 'pos' : 'warn'} />
        </View>
        <Text style={[styles.sources, { fontFamily: font('mono', '500') }]}>{sourceLine}</Text>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'flex-start',
    maxWidth: '94%',
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  conclusion: { fontSize: 13.5, lineHeight: 20, fontWeight: '800', color: colors.ink },
  section: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 11, paddingTop: 10 },
  sectionTitle: {
    fontSize: 10.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.dim,
    fontWeight: '700',
    marginBottom: 6,
  },
  body: { fontSize: 13, lineHeight: 20, color: '#cdd7e8' },
  kv: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 4,
  },
  kvLabel: { fontSize: 12.5, color: colors.mut, fontWeight: '600' },
  kvValue: { fontSize: 12.5, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sources: { fontSize: 11, lineHeight: 18, color: colors.dim, marginTop: 9 },
});
