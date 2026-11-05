import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AIAnswerPanel } from '@/components/AIAnswerPanel';
import { AIComposer } from '@/components/AIComposer';
import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { ChatBubble } from '@/components/ChatBubble';
import { DataMetadata } from '@/components/DataMetadata';
import { Panel } from '@/components/Panel';
import { Pulse } from '@/components/Pulse';
import { SecondaryButton } from '@/components/SecondaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { EmptyState } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';
import { font } from '@/lib/fonts';
import { useWatchlist } from '@/lib/hooks';
import { useAiAnalyst } from '@/lib/useAiAnalyst';
import { AI_QUESTION_MAX_CHARS } from '@/src/services/aiService';
import { colors } from '@/src/theme';

const SUGGESTED_PROMPTS = [
  '최근 재무 데이터에서 핵심 포인트를 정리해줘.',
  '현재 데이터에서 긍정 요인과 위험 요인을 균형 있게 보여줘.',
  '최근 제출된 공시 흐름을 설명해줘.',
  '현재 데이터만 기준으로 추가 확인이 필요한 부분은 뭐야?',
];

function normalizeSymbol(value: string | string[] | undefined): string | undefined {
  const symbol = Array.isArray(value) ? value[0] : value;
  return symbol && /^\d{6}$/.test(symbol) ? symbol : undefined;
}

export default function AiTab() {
  const router = useRouter();
  const params = useLocalSearchParams<{ symbol?: string | string[]; question?: string | string[] }>();
  const routeSymbol = normalizeSymbol(params.symbol);
  const routeQuestion = typeof params.question === 'string' ? params.question.trim() : '';
  const questionTooLong = routeQuestion.length > AI_QUESTION_MAX_CHARS;
  const watchlist = useWatchlist();
  const [selectedSymbol, setSelectedSymbol] = useState<string | undefined>(routeSymbol);
  const [input, setInput] = useState('');
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const companyNamesRef = useRef(new Map<string, string>());
  const savedCompanies = watchlist.data ?? [];
  savedCompanies.forEach(company => {
    companyNamesRef.current.set(company.symbol, company.name);
  });
  const selectedCompany = useMemo(
    () => savedCompanies.find(company => company.symbol === selectedSymbol),
    [savedCompanies, selectedSymbol],
  );
  const companyName = selectedCompany?.name
    ?? (selectedSymbol ? companyNamesRef.current.get(selectedSymbol) : undefined)
    ?? selectedSymbol
    ?? '';
  const analyst = useAiAnalyst(selectedSymbol, companyName);

  useEffect(() => {
    if (routeSymbol && routeSymbol !== selectedSymbol) {
      analyst.clearConversation();
      setInput('');
      setSelectedSymbol(routeSymbol);
    }
    if (params.question !== undefined) {
      if (questionTooLong) {
        setPrefillError(`질문 초안이 ${AI_QUESTION_MAX_CHARS}자 제한을 초과해 입력하지 않았습니다.`);
      } else if (routeQuestion) {
        setInput(routeQuestion);
        setPrefillError(null);
      }
      // Consume once so edits, company selection and conversation clearing cannot reapply the draft.
      router.setParams({ question: undefined });
    }
  }, [analyst.clearConversation, routeSymbol, selectedSymbol, params.question, routeQuestion, questionTooLong, router]);

  useEffect(() => {
    if (analyst.messages.length === 0 && !analyst.isGenerating && !analyst.error) return;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [analyst.error, analyst.isGenerating, analyst.messages.length]);

  const selectCompany = (symbol: string) => {
    if (symbol === selectedSymbol) return;
    analyst.clearConversation();
    setInput('');
    setPrefillError(null);
    setSelectedSymbol(symbol);
    router.setParams({ symbol });
  };

  const send = () => {
    if (!analyst.sendQuestion(input)) return;
    setInput('');
  };

  const openEvidence = (analysisId: string) => {
    router.push({ pathname: '/ai/evidence/[analysisId]', params: { analysisId } });
  };

  const selector = (
    <Panel style={styles.selectorPanel}>
      <View style={styles.selectorHeader}>
        <View style={styles.selectorTitle}>
          <Text style={[styles.selectorLabel, { fontFamily: font('body', '600') }]}>
            현재 분석 기업
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.currentCompany, { fontFamily: font('body', '700') }]}>
            {selectedSymbol ? `${companyName} · ${selectedSymbol}` : '기업을 선택하세요'}
          </Text>
        </View>
        {analyst.messages.length > 0 ? (
          <Pressable
            onPress={analyst.clearConversation}
            accessibilityRole="button"
            accessibilityLabel="현재 대화 지우기"
            style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}>
            <Text style={[styles.clearText, { fontFamily: font('body', '700') }]}>대화 지우기</Text>
          </Pressable>
        ) : null}
      </View>
      {savedCompanies.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.companyChips}>
          {savedCompanies.map(company => {
            const selected = company.symbol === selectedSymbol;
            return (
              <Pressable
                key={company.symbol}
                onPress={() => selectCompany(company.symbol)}
                disabled={analyst.isGenerating}
                accessibilityRole="button"
                accessibilityLabel={`${company.name} ${company.symbol} 분석 기업으로 선택`}
                accessibilityState={{ selected, disabled: analyst.isGenerating }}
                style={({ pressed }) => [
                  styles.companyChip,
                  selected && styles.companyChipSelected,
                  { opacity: analyst.isGenerating ? 0.5 : pressed ? 0.7 : 1 },
                ]}>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.companyChipName,
                    selected && styles.companyChipNameSelected,
                    { fontFamily: font('body', '700') },
                  ]}>
                  {company.name}
                </Text>
                <Text style={[styles.companyChipSymbol, { fontFamily: font('mono', '500') }]}>
                  {company.symbol}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </Panel>
  );

  return (
    <AppScreen scroll={false} padded={false} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <AppHeader subtitle="기업 데이터 기반 분석" title="AI Analyst" />
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.fill}
          contentContainerStyle={styles.chat}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {selector}

          {watchlist.status === 'loading' && !selectedSymbol ? (
            <Panel style={styles.statePanel}>
              <Text style={[styles.stateText, { fontFamily: font('body', '500') }]}>
                저장한 트윈을 불러오는 중입니다.
              </Text>
            </Panel>
          ) : null}

          {watchlist.status === 'empty' && !selectedSymbol ? (
            <Panel style={styles.statePanel}>
              <EmptyState
                title="분석할 기업을 먼저 선택하세요"
                message="저장한 트윈이 없습니다. Twin 화면에서 기업을 저장한 뒤 AI 분석을 시작할 수 있습니다."
                actionLabel="Twin으로 이동"
                onAction={() => router.navigate('/(tabs)/twin')}
                style={styles.emptyState}
              />
            </Panel>
          ) : null}

          {watchlist.status === 'error' && !selectedSymbol ? (
            <Panel style={styles.statePanel}>
              <Text style={[styles.stateTitle, { fontFamily: font('body', '700') }]}>
                저장한 트윈을 불러오지 못했습니다
              </Text>
              <Text style={[styles.stateText, { fontFamily: font('body', '500') }]}>
                기업 목록을 다시 불러온 뒤 분석할 기업을 선택해주세요.
              </Text>
              <SecondaryButton
                label="기업 목록 다시 불러오기"
                onPress={watchlist.reload}
                style={styles.retryButton}
              />
            </Panel>
          ) : null}

          {!selectedSymbol && savedCompanies.length > 0 ? (
            <Panel style={styles.statePanel}>
              <Text style={[styles.stateTitle, { fontFamily: font('body', '700') }]}>
                분석할 기업을 선택하세요
              </Text>
              <Text style={[styles.stateText, { fontFamily: font('body', '500') }]}>
                위 저장한 트윈 목록에서 기업을 선택하면 질문을 입력할 수 있습니다.
              </Text>
            </Panel>
          ) : null}

          {selectedSymbol && analyst.messages.length === 0 ? (
            <Panel>
              <SectionHeader label="기업 데이터 기반 Q&A" style={styles.panelHeader} />
              <Text style={[styles.intro, { fontFamily: font('body', '500') }]}>
                최근 확정 시세와 기업개황, 재무, 공시 구조화 데이터를 기준으로 답합니다.
                질문을 선택해 입력창에서 확인한 뒤 전송하세요.
              </Text>
            </Panel>
          ) : null}

          {analyst.messages.map(message =>
            message.role === 'user' ? (
              <ChatBubble key={message.id} text={message.content} style={styles.messageGap} />
            ) : (
              <AIAnswerPanel
                key={message.id}
                response={message.response}
                onOpenEvidence={
                  message.response.dataReferences.length > 0
                    ? () => openEvidence(message.analysisId)
                    : undefined
                }
                onApplyFollowUp={question => setInput(question)}
                style={styles.messageGap}
              />
            ),
          )}

          {analyst.isGenerating ? (
            <Panel style={styles.generating}>
              <View style={styles.generatingRow} accessibilityLabel="기업 데이터를 분석하고 있습니다">
                <Pulse minOpacity={0.35}>
                  <View style={styles.thinkingDot} />
                </Pulse>
                <Text style={[styles.thinkingText, { fontFamily: font('body', '600') }]}>
                  기업 데이터를 확인하고 분석하고 있습니다.
                </Text>
              </View>
              <SecondaryButton
                label="분석 취소"
                onPress={analyst.cancel}
                accessibilityLabel="AI 분석 요청 취소"
                style={styles.cancelButton}
              />
            </Panel>
          ) : null}

          {analyst.error ? (
            <View style={styles.errorCard} accessibilityLiveRegion="polite">
              <Text style={[styles.errorTitle, { fontFamily: font('body', '700') }]}>
                분석을 완료하지 못했습니다
              </Text>
              <Text style={[styles.errorText, { fontFamily: font('body', '500') }]}>
                {analyst.error.message}
              </Text>
              {analyst.canRetry ? (
                <SecondaryButton
                  label="같은 질문 다시 시도"
                  onPress={analyst.retry}
                  style={styles.retryButton}
                />
              ) : null}
            </View>
          ) : null}

          {analyst.cancelled ? (
            <View style={styles.cancelledNotice} accessibilityLiveRegion="polite">
              <StatusBadge label="분석 취소됨" tone="neutral" size="sm" />
              <Text style={[styles.cancelledText, { fontFamily: font('body', '500') }]}>
                질문은 대화에 남아 있으며 자동으로 다시 요청하지 않습니다.
              </Text>
            </View>
          ) : null}

          {selectedSymbol ? (
            <>
              <SectionHeader label="질문 제안 · Suggested" />
              <View style={styles.prompts}>
                {SUGGESTED_PROMPTS.map(prompt => (
                  <Pressable
                    key={prompt}
                    onPress={() => setInput(prompt)}
                    disabled={analyst.isGenerating}
                    accessibilityRole="button"
                    accessibilityLabel={`질문 입력: ${prompt}`}
                    style={({ pressed }) => [
                      styles.prompt,
                      { opacity: analyst.isGenerating ? 0.5 : pressed ? 0.7 : 1 },
                    ]}>
                    <Text style={[styles.promptText, { fontFamily: font('body', '600') }]}>
                      {prompt}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <DataMetadata
            items={[
              'AI 분석은 투자 권유나 수익 보장이 아닙니다',
              '답변과 데이터 기준일을 함께 확인하세요',
            ]}
            style={styles.meta}
          />
        </ScrollView>

        <View style={styles.inputBar}>
          {prefillError ? (
            <Text accessibilityLiveRegion="polite" style={styles.errorText}>{prefillError}</Text>
          ) : null}
          <AIComposer
            value={input}
            onChangeText={setInput}
            placeholder={
              selectedSymbol
                ? `${companyName}에 대해 질문하세요`
                : '먼저 분석할 기업을 선택하세요'
            }
            statusLabel={
              analyst.isGenerating
                ? '기업 데이터 분석 중'
                : selectedSymbol
                  ? `${input.length}/${AI_QUESTION_MAX_CHARS}`
                  : '기업 선택 필요'
            }
            busy={analyst.isGenerating}
            editable={!!selectedSymbol}
            maxLength={AI_QUESTION_MAX_CHARS}
            onSend={send}
            sendDisabled={!selectedSymbol || !input.trim() || analyst.isGenerating}
            sendAccessibilityLabel="AI Analyst에게 질문 전송"
          />
        </View>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { paddingHorizontal: 18 },
  chat: { paddingHorizontal: 18, paddingBottom: 18 },
  selectorPanel: { marginBottom: 12 },
  selectorHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectorTitle: { flex: 1, minWidth: 0 },
  selectorLabel: { color: colors.dim, fontSize: 10.5 },
  currentCompany: { color: colors.ink, fontSize: 14, marginTop: 4 },
  clearText: { color: colors.accent, fontSize: 11.5 },
  companyChips: { gap: 8, paddingTop: 12 },
  companyChip: {
    minWidth: 112,
    maxWidth: 168,
    minHeight: 52,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 7,
    paddingHorizontal: 11,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  companyChipSelected: {
    borderColor: 'rgba(34,211,238,0.45)',
    backgroundColor: 'rgba(34,211,238,0.08)',
  },
  companyChipName: { color: colors.mut, fontSize: 12.5 },
  companyChipNameSelected: { color: colors.ink },
  companyChipSymbol: { color: colors.dim, fontSize: 10, marginTop: 3 },
  statePanel: { marginBottom: 12 },
  emptyState: { paddingVertical: 24, paddingHorizontal: 12 },
  stateTitle: { color: colors.ink, fontSize: 14 },
  stateText: { color: colors.mut, fontSize: 12.5, lineHeight: 19, marginTop: 5 },
  panelHeader: { marginTop: 0, marginBottom: 0 },
  intro: { fontSize: 13.5, lineHeight: 21, color: colors.mut, marginTop: 9 },
  messageGap: { marginBottom: 12 },
  generating: { marginBottom: 12 },
  generatingRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  thinkingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  thinkingText: { flex: 1, fontSize: 12.5, color: colors.mut },
  cancelButton: { minHeight: 40, marginTop: 12, paddingVertical: 9 },
  errorCard: {
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.3)',
    borderRadius: 8,
    backgroundColor: 'rgba(248,113,113,0.06)',
    padding: 14,
    marginBottom: 12,
  },
  errorTitle: { color: colors.neg, fontSize: 13.5 },
  errorText: { color: colors.mut, fontSize: 12.5, lineHeight: 19, marginTop: 5 },
  retryButton: { minHeight: 40, marginTop: 12, paddingVertical: 9 },
  cancelledNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 12,
  },
  cancelledText: { flex: 1, color: colors.dim, fontSize: 11.5, lineHeight: 17 },
  prompts: { gap: 8, marginBottom: 4 },
  prompt: {
    minHeight: 42,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 7,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  promptText: { color: '#cdd7e8', fontSize: 12.5, lineHeight: 18 },
  meta: { marginTop: 14 },
  inputBar: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.bg,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 8 : 10,
  },
});
