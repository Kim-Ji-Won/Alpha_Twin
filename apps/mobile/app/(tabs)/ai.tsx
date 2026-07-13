// Frame 07 — AI Analyst: 근거 기반 Q&A 채팅.
// 상태: 입력 대기 → 전송/분석 중 → 답변 완료 | 오류. 빈 질문·중복 전송 방지.
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { AIAnswerPanel } from '@/components/AIAnswerPanel';
import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { ChatBubble } from '@/components/ChatBubble';
import { DataMetadata } from '@/components/DataMetadata';
import { Panel } from '@/components/Panel';
import { SectionHeader } from '@/components/SectionHeader';
import { font } from '@/lib/fonts';
import { aiService } from '@/src/services';
import { colors } from '@/src/theme';
import { AIAnalysis } from '@/src/types';

type ChatItem =
  | { kind: 'question'; id: string; text: string }
  | { kind: 'answer'; id: string; analysis: AIAnalysis }
  | { kind: 'error'; id: string; question: string };

const EXAMPLE_QUESTION = 'SK하이닉스 최근 주가 상승은 실적 개선 때문이야, 기대감 때문이야?';
const DEFAULT_FOLLOW_UPS = [
  '내 논제에 반대되는 근거는?',
  '경쟁사 대비 약점은?',
  '현재 위험 구간은?',
  '실적과 기대감 비중은?',
];

export default function AiTab() {
  const router = useRouter();
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false); // 전송·분석 중 — 중복 전송 방지
  const scrollRef = useRef<ScrollView>(null);
  const alive = useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);

  const lastAnswer = [...items].reverse().find((i): i is Extract<ChatItem, { kind: 'answer' }> => i.kind === 'answer');
  const followUps = lastAnswer?.analysis.followUps ?? DEFAULT_FOLLOW_UPS;

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return; // 빈 질문·중복 전송 방지
    setInput('');
    setBusy(true);
    setItems(prev => [...prev, { kind: 'question', id: `q-${Date.now()}`, text: q }]);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    try {
      const analysis = await aiService.ask(q);
      if (!alive.current) return;
      setItems(prev => [...prev, { kind: 'answer', id: analysis.id, analysis }]);
    } catch {
      if (!alive.current) return;
      setItems(prev => [...prev, { kind: 'error', id: `e-${Date.now()}`, question: q }]);
    } finally {
      if (alive.current) {
        setBusy(false);
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      }
    }
  };

  const openEvidence = (analysisId: string) =>
    router.push({ pathname: '/ai/evidence/[analysisId]', params: { analysisId } });

  return (
    <AppScreen scroll={false} padded={false} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <AppHeader subtitle="금융 전문 AI · 근거 기반" title="AI Analyst" live />
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.fill}
          contentContainerStyle={styles.chat}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {items.length === 0 ? (
            <Panel>
              <SectionHeader label="근거 기반 Q&A" style={styles.panelHeader} />
              <Text style={[styles.intro, { fontFamily: font('body', '500') }]}>
                종목·시장·포트폴리오에 대해 질문하면 결론과 근거, 반대 가능성까지 함께 답합니다.
                모든 수치는 분석 결과 인용이며, 답변마다 출처를 확인할 수 있습니다.
              </Text>
              <Pressable
                onPress={() => send(EXAMPLE_QUESTION)}
                accessibilityRole="button"
                accessibilityLabel={`예시 질문: ${EXAMPLE_QUESTION}`}
                style={({ pressed }) => [styles.exampleChip, { opacity: pressed ? 0.7 : 1 }]}>
                <Text style={[styles.exampleText, { fontFamily: font('body', '600') }]}>
                  {EXAMPLE_QUESTION}
                </Text>
              </Pressable>
            </Panel>
          ) : (
            items.map(item => {
              if (item.kind === 'question') {
                return <ChatBubble key={item.id} text={item.text} style={styles.gap} />;
              }
              if (item.kind === 'answer') {
                return (
                  <AIAnswerPanel
                    key={item.id}
                    analysis={item.analysis}
                    onOpenEvidence={() => openEvidence(item.analysis.id)}
                    style={styles.gap}
                  />
                );
              }
              return (
                <View key={item.id} style={[styles.errorBubble, styles.gap]}>
                  <Text style={[styles.errorText, { fontFamily: font('body', '600') }]}>
                    답변 생성에 실패했어요.
                  </Text>
                  <Pressable
                    onPress={() => send(item.question)}
                    accessibilityRole="button"
                    accessibilityLabel="다시 시도">
                    <Text style={[styles.retry, { fontFamily: font('body', '700') }]}>다시 시도</Text>
                  </Pressable>
                </View>
              );
            })
          )}

          {busy ? (
            <View style={[styles.thinking, styles.gap]} accessibilityLabel="AI 분석 중">
              <View style={styles.thinkingDot} />
              <Text style={[styles.thinkingText, { fontFamily: font('mono', '500') }]}>
                근거를 수집하고 분석 중… (Mock)
              </Text>
            </View>
          ) : null}

          <SectionHeader label="이어서 질문 · Follow-up" />
          <View style={styles.followUps}>
            {followUps.map(f => (
              <Pressable
                key={f}
                onPress={() => send(f)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`후속 질문: ${f}`}
                style={({ pressed }) => [styles.chip, { opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}>
                <Text style={[styles.chipText, { fontFamily: font('body', '600') }]}>{f}</Text>
              </Pressable>
            ))}
          </View>

          <DataMetadata
            items={['Mock AI · 실제 LLM 연동은 P3', '분석 보조 도구이며 투자 자문이 아닙니다']}
            style={styles.meta}
          />
        </ScrollView>

        {/* 질문 입력 — 디자인 .input 행 */}
        <View style={styles.inputBar}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="종목·시장·포트폴리오에 대해 질문하세요"
            placeholderTextColor={colors.dim}
            editable={!busy}
            onSubmitEditing={() => send(input)}
            returnKeyType="send"
            accessibilityLabel="AI에게 질문 입력"
            style={[styles.input, { fontFamily: font('body', '500') }]}
          />
          <Pressable
            onPress={() => send(input)}
            disabled={busy || !input.trim()}
            accessibilityRole="button"
            accessibilityLabel="질문 전송"
            style={({ pressed }) => [
              styles.send,
              { opacity: busy || !input.trim() ? 0.4 : pressed ? 0.8 : 1 },
            ]}>
            <Svg width={15} height={15} viewBox="0 0 16 16">
              <Path
                d="M3 8h9M8 4l4 4-4 4"
                stroke="#03121b"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: 18 },
  chat: { paddingHorizontal: 18, paddingBottom: 16 },
  panelHeader: { marginTop: 0, marginBottom: 0 },
  intro: { fontSize: 13.5, lineHeight: 21, color: '#b8c4da', marginTop: 9 },
  exampleChip: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.3)',
    backgroundColor: 'rgba(34,211,238,0.08)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 44,
    justifyContent: 'center',
  },
  exampleText: { fontSize: 13, lineHeight: 19, color: colors.accent, fontWeight: '600' },
  gap: { marginBottom: 12 },
  errorBubble: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.3)',
    backgroundColor: 'rgba(248,113,113,0.08)',
    paddingVertical: 12,
    paddingHorizontal: 15,
  },
  errorText: { fontSize: 13, color: colors.neg, fontWeight: '600' },
  retry: { fontSize: 13, color: colors.accent, fontWeight: '700' },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  thinkingDot: { width: 7, height: 7, borderRadius: 99, backgroundColor: colors.accent },
  thinkingText: { fontSize: 11, color: colors.accent },
  followUps: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 99,
    paddingVertical: 9,
    paddingHorizontal: 12,
    minHeight: 38,
    justifyContent: 'center',
  },
  chipText: { fontSize: 12.5, color: '#cdd7e8', fontWeight: '600' },
  meta: { marginTop: 12 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 18,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.25)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    paddingVertical: 8,
    paddingLeft: 15,
    paddingRight: 8,
  },
  input: { flex: 1, fontSize: 13.5, color: colors.ink, paddingVertical: 6, padding: 0 },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
