// Frame 01 — Market Brain: 오늘 시장의 핵심만.
// 국면 히어로 + 지표 3 + 포트폴리오 영향 + 핵심 이벤트 + FoldRow(수급/산업/이상).
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { AnalysisConfidence } from '@/components/AnalysisConfidence';
import { DataMetadata, formatAsOf } from '@/components/DataMetadata';
import { EventRow } from '@/components/EventRow';
import { FoldSection } from '@/components/FoldSection';
import { FactorRow } from '@/components/FactorRow';
import { HeroCard } from '@/components/HeroCard';
import { Panel } from '@/components/Panel';
import { ScoreMetric } from '@/components/ScoreMetric';
import { SectionHeader } from '@/components/SectionHeader';
import { ErrorState, LoadingState } from '@/components/States';
import { signed } from '@/lib/direction';
import { font } from '@/lib/fonts';
import { useMarketBrain } from '@/lib/hooks';
import { colors } from '@/src/theme';
import { Severity } from '@/src/types';

const SEVERITY_TEXT: Record<Severity, { label: string; color: string }> = {
  high: { label: '높음', color: colors.neg },
  medium: { label: '보통', color: colors.warn },
  low: { label: '낮음', color: colors.pos },
};

// 수급 금액: '+8,420' / '−2,710' (디자인 표기 — 천 단위 구분 + U+2212)
function signedComma(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString()}`;
}

function koreanDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${weekdays[d.getDay()]}요일`;
}

// 수급 흐름 행 — 중앙 기준 좌(순매도)/우(순매수) 바 (디자인 .flowrow)
function FlowRow({ label, value }: { label: string; value: number }) {
  const positive = value >= 0;
  // 디자인 스케일: 외국인 +8,420억 ≈ 폭 34%
  const widthPct = Math.min(Math.abs(value) / 250, 48);
  return (
    <View
      style={styles.flowRow}
      accessibilityLabel={`${label} ${positive ? '순매수' : '순매도'} ${Math.abs(value).toLocaleString()}억 원`}>
      <Text style={[styles.flowLabel, { fontFamily: font('body', '600') }]}>{label}</Text>
      <View style={styles.flowTrack}>
        <View
          style={[
            styles.flowFill,
            positive
              ? { left: '50%', width: `${widthPct}%`, backgroundColor: colors.accent }
              : { right: '50%', width: `${widthPct}%`, backgroundColor: colors.neg },
          ]}
        />
      </View>
      <Text
        style={[
          styles.flowValue,
          { color: positive ? colors.pos : colors.neg, fontFamily: font('mono', '600') },
        ]}>
        {signedComma(value)}
      </Text>
    </View>
  );
}

// 헤더 우측 진입점 — 알림 센터(09) · 프로필(25)
function HeaderActions() {
  const router = useRouter();
  return (
    <View style={styles.headerActions}>
      <Pressable
        onPress={() => router.push('/notifications')}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="알림 센터 열기"
        style={styles.headerBtn}>
        <Svg width={15} height={15} viewBox="0 0 16 16">
          <Path
            d="M8 2a4 4 0 0 0-4 4v3l-1.3 2.3h10.6L12 9V6a4 4 0 0 0-4-4zM6.5 13.5a1.5 1.5 0 0 0 3 0"
            stroke={colors.mut}
            strokeWidth={1.4}
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </Pressable>
      <Pressable
        onPress={() => router.push('/profile')}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="프로필 열기"
        style={styles.headerBtn}>
        <Svg width={15} height={15} viewBox="0 0 16 16">
          <Circle cx={8} cy={5.5} r={2.8} stroke={colors.mut} strokeWidth={1.4} fill="none" />
          <Path d="M2.8 13.5a5.2 5.2 0 0 1 10.4 0" stroke={colors.mut} strokeWidth={1.4} fill="none" strokeLinecap="round" />
        </Svg>
      </Pressable>
    </View>
  );
}

export default function HomeTab() {
  const router = useRouter();
  const { status, data, reload } = useMarketBrain();

  const openCompany = (symbol: string) =>
    router.push({ pathname: '/company/[symbol]', params: { symbol } });

  if (status === 'loading' || status === 'empty') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']}>
        <AppHeader subtitle="ALPHA TWIN" title="Market Brain" live right={<HeaderActions />} />
        <LoadingState stage="시장 국면 분석 불러오는 중" />
      </AppScreen>
    );
  }
  if (status === 'error' || !data) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']}>
        <AppHeader subtitle="ALPHA TWIN" title="Market Brain" live right={<HeaderActions />} />
        <ErrorState onRetry={reload} />
      </AppScreen>
    );
  }

  const { regime, events, netFlow, sectors, portfolioImpact, anomalies } = data;
  const risk = SEVERITY_TEXT[regime.riskLevel];
  const strongTop = sectors.strong[0];
  const weakTop = sectors.weak[0];

  return (
    <AppScreen edges={['top', 'left', 'right']}>
      <AppHeader
        subtitle={`${koreanDate(regime.asOf)}${regime.indexLabel ? ` · ${regime.indexLabel}` : ''}`}
        title="Market Brain"
        live
        right={<HeaderActions />}
      />

      <HeroCard tag="현재 시장 국면 · MARKET REGIME">
        <Text style={[styles.regimeTitle, { fontFamily: font('body', '800') }]}>
          {regime.label}
        </Text>
        {regime.en ? (
          <Text style={[styles.regimeEn, { fontFamily: font('mono', '500') }]}>{regime.en}</Text>
        ) : null}
        {regime.summary ? (
          <Text style={[styles.regimeSummary, { fontFamily: font('body', '500') }]}>
            {regime.summary}
          </Text>
        ) : null}
        <AnalysisConfidence label="국면 신뢰도" pct={regime.confidence ?? regime.probability} />
      </HeroCard>

      <View style={styles.g3}>
        <ScoreMetric label="시장 위험" value={risk.label} valueColor={risk.color} textValue sub={regime.riskNote} />
        <ScoreMetric label="투자 심리" value={regime.sentiment} valueColor={colors.accent} textValue sub={regime.sentimentTrend} subColor={colors.pos} />
        <ScoreMetric label="변동성" value={regime.volatility} valueColor={colors.warn} textValue sub={regime.volatilityNote} />
      </View>

      <Panel variant="alert" style={styles.impactPanel}>
        <SectionHeader label="내 포트폴리오 영향 · IMPACT" meta="● LIVE" style={styles.panelHeader} />
        <Text style={[styles.impactText, { fontFamily: font('body', '500') }]}>
          {portfolioImpact.headline}
        </Text>
        <View style={styles.chips}>
          {portfolioImpact.symbols.map(s => (
            <Pressable
              key={s.symbol}
              onPress={() => openCompany(s.symbol)}
              accessibilityRole="button"
              accessibilityLabel={`${s.name} 기업 트윈 열기`}
              style={({ pressed }) => [styles.chip, { opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[styles.chipText, { fontFamily: font('body', '600') }]}>{s.name}</Text>
            </Pressable>
          ))}
        </View>
      </Panel>

      <SectionHeader label="오늘의 핵심 이벤트 · Key Events" meta={`${events.length}건`} />
      <View style={styles.eventList}>
        {events.map((e, i) => {
          const target = /^\d{6}$/.test(e.symbol) ? e.symbol : e.relatedSymbol;
          return (
            <EventRow
              key={e.id}
              event={e}
              first={i === 0}
              onPress={target ? () => openCompany(target) : undefined}
            />
          );
        })}
      </View>

      <FoldSection
        title="수급 흐름 · Net Flow"
        summary={
          <Text style={[styles.foldSummary, { fontFamily: font('mono', '600') }]}>
            {netFlow[0] ? (
              <Text style={{ color: netFlow[0].value >= 0 ? colors.pos : colors.neg }}>
                {netFlow[0].label} {signedComma(netFlow[0].value)}억
              </Text>
            ) : (
              '데이터 없음'
            )}
          </Text>
        }>
        {netFlow.map(f => (
          <FlowRow key={f.label} label={f.label} value={f.value} />
        ))}
        <Text style={[styles.foldFoot, { fontFamily: font('mono', '500') }]}>
          단위: 억 원 · 좌 = 순매도 · 우 = 순매수
        </Text>
      </FoldSection>

      <FoldSection
        title="산업 강세 · 약세"
        summary={
          strongTop && weakTop
            ? `${strongTop.name} ${signed(strongTop.pct, '%')} · ${weakTop.name} ${signed(weakTop.pct, '%')}`
            : '데이터 없음'
        }>
        {sectors.strong.map(s => (
          <FactorRow
            key={s.name}
            label={s.name}
            pct={Math.abs(s.pct) / 4}
            tone={colors.pos}
            valueText={signed(s.pct, '%')}
            valueColor={colors.pos}
          />
        ))}
        {sectors.weak.map(s => (
          <FactorRow
            key={s.name}
            label={s.name}
            pct={Math.abs(s.pct) / 4}
            tone={colors.neg}
            valueText={signed(s.pct, '%')}
            valueColor={colors.neg}
          />
        ))}
      </FoldSection>

      <FoldSection
        title="AI 이상 탐지"
        bottomLine
        summary={
          <Text style={[styles.foldSummary, { color: colors.accent, fontFamily: font('mono', '600') }]}>
            {anomalies.length > 0 ? `${anomalies.length}건 · ${anomalies[0].sigma}σ` : '0건'}
          </Text>
        }>
        {anomalies.map(a => (
          <Pressable
            key={a.id}
            onPress={a.symbol ? () => openCompany(a.symbol!) : undefined}
            accessibilityRole={a.symbol ? 'button' : undefined}
            accessibilityLabel={`${a.name} 이상 신호 ${a.sigma} 시그마`}
            style={({ pressed }) => [styles.anomalyRow, { opacity: pressed ? 0.75 : 1 }]}>
            <View style={styles.anomalyHead}>
              <Text style={[styles.anomalyName, { fontFamily: font('body', '700') }]}>{a.name}</Text>
              <Text style={[styles.anomalySigma, { fontFamily: font('mono', '600') }]}>
                {a.sigma}σ
              </Text>
            </View>
            <Text style={[styles.anomalyNote, { fontFamily: font('body', '500') }]}>{a.note}</Text>
          </Pressable>
        ))}
      </FoldSection>

      <DataMetadata
        items={[`데이터 기준 ${formatAsOf(regime.asOf)}`, '분석 보조 도구이며 투자 자문이 아닙니다']}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  regimeTitle: { marginTop: 8, fontSize: 25, fontWeight: '800', letterSpacing: -0.5, color: colors.ink },
  regimeEn: { fontSize: 12, color: colors.mut, marginTop: 2, marginBottom: 10 },
  regimeSummary: { fontSize: 14, lineHeight: 22, color: '#b8c4da' },
  g3: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  impactPanel: { marginBottom: 4 },
  panelHeader: { marginTop: 0, marginBottom: 0 },
  impactText: { fontSize: 13.5, lineHeight: 21, color: '#b8c4da', marginTop: 9 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 11 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 99,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    minHeight: 34,
    justifyContent: 'center',
  },
  chipText: { fontSize: 12.5, fontWeight: '600', color: '#cdd7e8' },
  eventList: { paddingHorizontal: 2, marginBottom: 6 },
  foldSummary: { fontSize: 11.5, color: colors.dim, fontWeight: '600' },
  foldFoot: { fontSize: 10.5, color: colors.dim, marginTop: 6 },
  flowRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  flowLabel: { width: 54, fontSize: 13, color: colors.mut, fontWeight: '600' },
  flowTrack: {
    flex: 1,
    height: 8,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  flowFill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 99 },
  flowValue: { width: 62, textAlign: 'right', fontSize: 12.5, fontWeight: '600' },
  anomalyRow: { paddingVertical: 9 },
  anomalyHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  anomalyName: { fontSize: 14, fontWeight: '700', color: colors.ink },
  anomalySigma: { fontSize: 12, color: colors.accent, fontWeight: '600' },
  anomalyNote: { fontSize: 12.5, lineHeight: 19, color: colors.mut, marginTop: 4 },
  meta: { marginTop: 14 },
});
