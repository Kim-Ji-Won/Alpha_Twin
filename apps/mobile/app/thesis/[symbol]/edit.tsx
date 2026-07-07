// Frame 21 — 투자 논제 작성·수정: 자연어 → AI 구조화(Mock) → 항목 편집 → 저장.
// 저장은 AsyncStorage(thesisService.save) — Thesis OS 복귀 시 반영.
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AIComposer } from '@/components/AIComposer';
import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { StaticTabBar } from '@/components/StaticTabBar';
import { CheckItem } from '@/components/CheckItem';
import { Panel } from '@/components/Panel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SecondaryButton } from '@/components/SecondaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { LoadingState } from '@/components/States';
import { font } from '@/lib/fonts';
import { useQuote } from '@/lib/hooks';
import { useSafeBack } from '@/lib/useSafeBack';
import { thesisService } from '@/src/services';
import { colors } from '@/src/theme';
import { InvestmentThesis, KillCriterion, ThesisHypothesis, ThesisSignal } from '@/src/types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// 삭제 버튼 — 가설/지표/실패 조건 공용 (44pt 터치 영역)
function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={`${label} 삭제`}
      style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.6 : 1 }]}>
      <Text style={[styles.removeText, { fontFamily: font('mono', '600') }]}>✕</Text>
    </Pressable>
  );
}

// 항목 추가 입력 행
function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onAdd(t);
    setText('');
  };
  return (
    <View style={styles.addRow}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={colors.dim}
        onSubmitEditing={submit}
        returnKeyType="done"
        accessibilityLabel={placeholder}
        style={[styles.addInput, { fontFamily: font('body', '500') }]}
      />
      <Pressable
        onPress={submit}
        accessibilityRole="button"
        accessibilityLabel="항목 추가"
        style={({ pressed }) => [styles.addBtn, { opacity: pressed ? 0.7 : 1 }]}>
        <Text style={[styles.addBtnText, { fontFamily: font('mono', '700') }]}>＋</Text>
      </Pressable>
    </View>
  );
}

export default function ThesisEditRoute() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const { data: quote } = useQuote(symbol ?? '');
  const goBack = useSafeBack({ pathname: '/thesis/[symbol]', params: { symbol: symbol ?? '' } });

  const [existing, setExisting] = useState<InvestmentThesis | null>(null);
  const [loading, setLoading] = useState(true);
  const [rawText, setRawText] = useState('');
  const [hypotheses, setHypotheses] = useState<ThesisHypothesis[]>([]);
  const [signals, setSignals] = useState<ThesisSignal[]>([]);
  const [killCriteria, setKillCriteria] = useState<KillCriterion[]>([]);
  const [structured, setStructured] = useState(false);
  const [structuring, setStructuring] = useState(false);
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);

  // 기존 논제 불러오기 — 있으면 수정 모드로 초기화
  useEffect(() => {
    alive.current = true;
    thesisService
      .getBySymbol(symbol ?? '')
      .then(t => {
        if (!alive.current) return;
        if (t) {
          setExisting(t);
          setRawText(t.rawText);
          setHypotheses(t.hypotheses);
          setSignals(t.signals);
          setKillCriteria(t.killCriteria);
          setStructured(true);
        }
      })
      .finally(() => alive.current && setLoading(false));
    return () => {
      alive.current = false;
    };
  }, [symbol]);

  const structure = async () => {
    if (!rawText.trim() || structuring) return;
    setStructuring(true);
    try {
      const s = await thesisService.structureFromText(rawText.trim());
      if (!alive.current) return;
      setHypotheses(s.hypotheses);
      setSignals(s.signals);
      setKillCriteria(s.killCriteria);
      setStructured(true);
    } finally {
      if (alive.current) setStructuring(false);
    }
  };

  const save = async () => {
    if (saving || !structured || hypotheses.length === 0) return; // 중복 실행 방지
    setSaving(true);
    try {
      const date = today();
      const summary = `가설 ${hypotheses.length} · 지표 ${signals.length} · 실패 조건 ${killCriteria.length}`;
      const thesis: InvestmentThesis = existing
        ? {
            ...existing,
            rawText: rawText.trim(),
            hypotheses,
            signals,
            killCriteria,
            version: existing.version + 1,
            changes: [
              {
                date,
                kind: 'user_edit',
                reason: `사용자 수정 · 논제 v${existing.version + 1} — ${summary}로 재구조화.`,
              },
              ...existing.changes,
            ],
          }
        : {
            id: `th-${symbol}`,
            symbol: symbol ?? '',
            rawText: rawText.trim(),
            createdAt: date,
            version: 1,
            healthScore: 75, // 초기값 — 근거 수집 전 기준점 (실서비스: 계산값)
            healthTrend: { delta: 0, period: '1D' },
            healthHistory: [{ date, score: 75 }],
            hypotheses,
            signals,
            killCriteria,
            evidence: { positive: 0, negative: 0, unverified: hypotheses.length },
            changes: [{ date, kind: 'created', reason: `최초 작성 · ${summary}로 구조화. 감시 시작.` }],
          };
      await thesisService.save(thesis);
      if (alive.current) goBack();
    } finally {
      if (alive.current) setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
        <LoadingState stage="논제 불러오는 중" />
      </AppScreen>
    );
  }

  return (
    <AppScreen keyboardAvoid edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
      <AppHeader
        onBack={goBack}
        subtitle={quote ? `${quote.name} · Thesis OS` : (symbol ?? '')}
        title={existing ? '논제 수정' : '논제 작성'}
      />

      <AIComposer
        value={rawText}
        onChangeText={setRawText}
        placeholder="예: 이 기업은 AI 반도체 수요 증가로 실적이 개선될 것이라고 생각한다"
        statusLabel={
          structuring
            ? 'AI가 검증 가능한 논제로 변환 중'
            : structured
              ? '구조화 완료 · 아래에서 수정할 수 있어요'
              : '작성 후 전송하면 AI가 구조화합니다'
        }
        busy={structuring}
        onSend={structure}
        sendDisabled={!rawText.trim()}
        sendAccessibilityLabel="논제 구조화 요청"
      />

      <SectionHeader label="구조화 미리보기 · Preview" />

      <Panel>
        <SectionHeader label={`핵심 가설 ${hypotheses.length} · Hypotheses`} style={styles.panelHeader} />
        <View style={styles.list}>
          {hypotheses.map((h, i) => (
            <CheckItem
              key={h.id}
              status={h.status}
              iconOverride={String(i + 1)}
              title={h.text}
              note={h.evidenceNote || undefined}
              first={i === 0}
              right={
                <RemoveButton
                  label={`가설 ${i + 1}`}
                  onPress={() => setHypotheses(prev => prev.filter(x => x.id !== h.id))}
                />
              }
            />
          ))}
          {hypotheses.length === 0 ? (
            <Text style={[styles.empty, { fontFamily: font('body', '500') }]}>
              {structured ? '가설을 추가하세요.' : '논제를 전송하면 가설이 생성됩니다.'}
            </Text>
          ) : null}
        </View>
        <AddRow
          placeholder="가설 직접 추가"
          onAdd={text =>
            setHypotheses(prev => [
              ...prev,
              { id: `h-${Date.now()}`, text, status: 'unverified', evidenceNote: '' },
            ])
          }
        />
      </Panel>

      <Panel>
        <SectionHeader label={`자동 추적 지표 ${signals.length} · Signals`} style={styles.panelHeader} />
        <View style={styles.chipWrap}>
          {signals.map(s => (
            <View key={s.label} style={styles.signalChip}>
              <Text style={[styles.signalText, { fontFamily: font('body', '600') }]}>{s.label}</Text>
              <RemoveButton
                label={`지표 ${s.label}`}
                onPress={() => setSignals(prev => prev.filter(x => x.label !== s.label))}
              />
            </View>
          ))}
          {signals.length === 0 ? (
            <Text style={[styles.empty, { fontFamily: font('body', '500') }]}>추적할 지표가 없습니다.</Text>
          ) : null}
        </View>
        <AddRow
          placeholder="지표 직접 추가 (예: HBM 출하량)"
          onAdd={label =>
            setSignals(prev =>
              prev.some(s => s.label === label)
                ? prev
                : [...prev, { label, value: '—', direction: 'neutral' }],
            )
          }
        />
      </Panel>

      <Panel variant="danger">
        <SectionHeader label={`실패 조건 ${killCriteria.length} · Kill Criteria`} style={styles.panelHeader} />
        <View style={styles.list}>
          {killCriteria.map((k, i) => (
            <View key={k.text} style={[styles.killRow, i === 0 && styles.killRowFirst]}>
              <Text style={[styles.killText, { fontFamily: font('body', '600') }]}>{k.text}</Text>
              <RemoveButton
                label={`실패 조건 ${k.text}`}
                onPress={() => setKillCriteria(prev => prev.filter(x => x.text !== k.text))}
              />
            </View>
          ))}
          {killCriteria.length === 0 ? (
            <Text style={[styles.empty, { fontFamily: font('body', '500') }]}>
              이 조건이 충족되면 알림으로 알려드립니다.
            </Text>
          ) : null}
        </View>
        <AddRow
          placeholder="실패 조건 직접 추가"
          onAdd={text =>
            setKillCriteria(prev =>
              prev.some(k => k.text === text) ? prev : [...prev, { text, status: 'safe' }],
            )
          }
        />
      </Panel>

      <View style={styles.cta}>
        <SecondaryButton label="취소" onPress={goBack} style={styles.ctaCancel} />
        <PrimaryButton
          label={saving ? '저장 중…' : '논제 저장 · 감시 시작'}
          onPress={save}
          disabled={saving || !structured || hypotheses.length === 0}
          style={styles.ctaSave}
        />
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  panelHeader: { marginTop: 0, marginBottom: 0 },
  list: { marginTop: 6 },
  empty: { fontSize: 13, lineHeight: 20, color: colors.mut, paddingVertical: 8 },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeText: { fontSize: 12, color: colors.dim },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 10,
  },
  addInput: {
    flex: 1,
    fontSize: 13,
    color: colors.ink,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { fontSize: 16, color: colors.accent },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  signalChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 99,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 2,
    backgroundColor: 'rgba(255,255,255,0.04)',
    minHeight: 36,
  },
  signalText: { fontSize: 12.5, color: '#cdd7e8', fontWeight: '600' },
  killRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    minHeight: 40,
  },
  killRowFirst: { borderTopWidth: 0 },
  killText: { flex: 1, fontSize: 13.5, color: '#cdd7e8', fontWeight: '600' },
  cta: { flexDirection: 'row', gap: 10, marginTop: 16 },
  ctaCancel: { flex: 0.6 },
  ctaSave: { flex: 1 },
});
