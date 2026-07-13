// Frame 03 — Scenario Lab 조건 입력: 자연어 → 구조화.
// AIComposer + 템플릿 칩(입력·구조화 동시 변경) + 파싱 미리보기 + 분석 범위 + 진행 상태.
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AIComposer } from '@/components/AIComposer';
import { AnimatedBar } from '@/components/AnimatedBar';
import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { StaticTabBar } from '@/components/StaticTabBar';
import { MetricItem } from '@/components/MetricItem';
import { Panel } from '@/components/Panel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScenarioTemplateChip } from '@/components/ScenarioTemplateChip';
import { SectionHeader } from '@/components/SectionHeader';
import { SegmentedControl } from '@/components/SegmentedControl';
import { font } from '@/lib/fonts';
import { useQuote } from '@/lib/hooks';
import { useSafeBack } from '@/lib/useSafeBack';
import { scenarioService } from '@/src/services';
import { colors } from '@/src/theme';
import { Scenario } from '@/src/types';

export default function ScenarioInputRoute() {
  const router = useRouter();
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const { data: quote } = useQuote(symbol ?? '');
  const goBack = useSafeBack({ pathname: '/company/[symbol]', params: { symbol: symbol ?? '' } });
  const templates = scenarioService.templates;

  const [rawQuery, setRawQuery] = useState(templates[0].rawQuery);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(templates[0].id);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [parsing, setParsing] = useState(false);
  const [scope, setScope] = useState(0);
  const [starting, setStarting] = useState(false);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 파싱 요청 — 템플릿 선택/전송 시 호출. 언마운트 후 setState 방지.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    // 초기 진입: 기본 템플릿을 구조화해 미리보기 표시
    parseQuery(templates[0].rawQuery, templates[0].id);
    return () => {
      alive.current = false;
      if (startTimer.current) clearTimeout(startTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function parseQuery(query: string, templateId?: string) {
    setParsing(true);
    try {
      const parsed = await scenarioService.parse(query, { symbol: symbol ?? undefined, templateId });
      if (alive.current) setScenario(parsed);
    } finally {
      if (alive.current) setParsing(false);
    }
  }

  const selectTemplate = (id: string) => {
    const t = templates.find(tp => tp.id === id);
    if (!t) return;
    // 템플릿 선택 → 입력 내용과 구조화된 값이 함께 변경
    setSelectedTemplateId(id);
    setRawQuery(t.rawQuery);
    parseQuery(t.rawQuery, id);
  };

  const onSend = () => {
    if (!rawQuery.trim()) return;
    setSelectedTemplateId(undefined);
    parseQuery(rawQuery.trim());
  };

  const startAnalysis = () => {
    if (!scenario || starting) return; // 로딩 중 중복 실행 방지
    setStarting(true);
    // 디자인 프레임 03의 '분석 진행' 상태를 잠깐 보여준 뒤 결과로 이동
    startTimer.current = setTimeout(() => {
      setStarting(false);
      router.push({
        pathname: '/scenario/[symbol]/result',
        params: { symbol: symbol ?? '', scenarioId: scenario.id },
      });
    }, 900);
  };

  const statusLabel = parsing
    ? 'AI가 조건을 인식하는 중'
    : scenario
      ? `조건 인식 완료 · 신뢰도 ${Math.round((scenario.parseConfidence ?? 0.9) * 100)}%`
      : '조건을 입력하세요';

  return (
    <AppScreen keyboardAvoid edges={['top', 'left', 'right']} tabBar={<StaticTabBar />}>
      <AppHeader
        onBack={goBack}
        subtitle={quote ? `${quote.name} · ${quote.symbol}` : (symbol ?? '')}
        title="Scenario Lab"
      />
      <Text style={[styles.cap, { fontFamily: font('body', '500') }]}>
        미래 상황을 직접 입력하면 AI가 구조화된 시나리오로 변환하고 기업·포트폴리오 영향을
        실험합니다.
      </Text>

      <AIComposer
        value={rawQuery}
        onChangeText={setRawQuery}
        placeholder="예: 원/달러 환율이 10% 하락하면 어떻게 될까?"
        statusLabel={statusLabel}
        busy={parsing}
        onSend={onSend}
        sendDisabled={!rawQuery.trim()}
        sendAccessibilityLabel="시나리오 조건 인식 요청"
      />

      <SectionHeader label="빠른 시나리오 · Templates" />
      <View style={styles.templateGrid}>
        {templates.map(t => (
          <ScenarioTemplateChip
            key={t.id}
            label={t.label}
            valueLabel={t.valueLabel}
            selected={t.id === selectedTemplateId}
            onPress={() => selectTemplate(t.id)}
            style={styles.templateTile}
          />
        ))}
      </View>

      <Panel style={styles.parsedPanel}>
        <SectionHeader
          label="인식된 시나리오 · Parsed"
          meta={scenario ? `신뢰도 ${Math.round((scenario.parseConfidence ?? 0.9) * 100)}%` : '대기'}
          style={styles.panelHeader}
        />
        {scenario ? (
          <View style={styles.parsedBody}>
            <MetricItem first label="변수" value={scenario.parsed.variable} />
            <MetricItem label="변화" value={`${scenario.parsed.from} → ${scenario.parsed.to}`} />
            <MetricItem label="기간" value={scenario.parsed.horizon} />
            {scenario.parsed.impactItems ? (
              <MetricItem label="영향 재무항목" value={scenario.parsed.impactItems} />
            ) : null}
          </View>
        ) : (
          <Text style={[styles.parsedEmpty, { fontFamily: font('body', '500') }]}>
            {parsing ? 'AI가 조건을 구조화하는 중입니다…' : '템플릿을 선택하거나 조건을 입력하세요.'}
          </Text>
        )}
      </Panel>

      <SectionHeader label="분석 범위 · Scope" />
      <SegmentedControl
        options={['이 종목', '포트폴리오 전체']}
        selectedIndex={scope}
        onChange={setScope}
        style={styles.scope}
      />

      {starting ? (
        <Panel style={styles.progressPanel}>
          <SectionHeader label="분석 진행" style={styles.panelHeader} />
          <AnimatedBar
            progress={1}
            color={colors.accent}
            style={styles.progressTrack}
            fillStyle={styles.progressFill}
            accessibilityLabel="시나리오 분석 진행 중"
          />
          <Text style={[styles.progressText, { fontFamily: font('mono', '500') }]}>
            ML 재무영향 · 딥러닝 관계전파 · LLM 설명 결합 중…
          </Text>
        </Panel>
      ) : null}

      <PrimaryButton
        label={starting ? '분석 중…' : '시나리오 분석 시작'}
        onPress={startAnalysis}
        disabled={!scenario || parsing || starting}
        style={styles.startBtn}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  cap: { fontSize: 13.5, lineHeight: 21, color: '#b8c4da', marginBottom: 14, paddingHorizontal: 2 },
  templateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  templateTile: { width: '48%', flexGrow: 1 },
  parsedPanel: { marginTop: 14, borderColor: 'rgba(34,211,238,0.22)' },
  panelHeader: { marginTop: 0, marginBottom: 0 },
  parsedBody: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: 12,
    marginTop: 8,
  },
  parsedEmpty: { fontSize: 13, color: colors.mut, marginTop: 10 },
  scope: { marginBottom: 4 },
  progressPanel: { marginTop: 14 },
  progressTrack: {
    height: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
    marginTop: 10,
  },
  progressFill: { borderRadius: 99, opacity: 0.85 },
  progressText: { fontSize: 11, color: colors.dim, marginTop: 10 },
  startBtn: { marginTop: 14 },
});
