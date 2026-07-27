import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { DataMetadata, formatAsOf } from '@/components/DataMetadata';
import { StatusBadge } from '@/components/StatusBadge';
import { font } from '@/lib/fonts';
import { colors } from '@/src/theme';
import {
  AiAnalysisPointDto,
  AiAnalysisStatus,
  AiAnalystResponseDto,
  AiContextSource,
} from '@/src/types/ai';

const STATUS_META: Record<
  AiAnalysisStatus,
  { label: string; tone: 'accent' | 'warn' | 'neutral' }
> = {
  answered: { label: '분석 완료', tone: 'accent' },
  partial: { label: '일부 데이터 기준 분석', tone: 'warn' },
  insufficient_context: { label: '현재 데이터 범위 안내', tone: 'neutral' },
  boundary: { label: 'AI 분석 범위 안내', tone: 'neutral' },
};

const SOURCE_LABEL: Record<AiContextSource, string> = {
  market: '시세',
  profile: '기업개황',
  financial: '재무',
  disclosures: '공시',
};

export interface AIAnswerPanelProps {
  response: AiAnalystResponseDto;
  onOpenEvidence?: () => void;
  onApplyFollowUp?: (question: string) => void;
  style?: ViewStyle;
}

function PointSection({
  title,
  points,
}: {
  title: string;
  points: AiAnalysisPointDto[];
}) {
  if (points.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { fontFamily: font('body', '700') }]}>{title}</Text>
      <View style={styles.pointList}>
        {points.map((point, index) => (
          <View key={`${point.text}-${index}`} style={styles.pointRow}>
            <View style={styles.bullet} />
            <View style={styles.pointBody}>
              <Text style={[styles.body, { fontFamily: font('body', '500') }]}>
                {point.text}
              </Text>
              {point.evidenceRefs.length > 0 ? (
                <Text style={[styles.refCount, { fontFamily: font('mono', '500') }]}>
                  참조 {point.evidenceRefs.length}개
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function AIAnswerPanel({
  response,
  onOpenEvidence,
  onApplyFollowUp,
  style,
}: AIAnswerPanelProps) {
  const status = STATUS_META[response.status];
  const missing = response.metadata.missingSources.map(source => SOURCE_LABEL[source]);
  const freshness = [
    response.metadata.dataAsOf.market
      ? `최근 확정 시세 ${formatAsOf(response.metadata.dataAsOf.market)}`
      : null,
    response.metadata.dataAsOf.financialPeriod
      ? `재무 ${response.metadata.dataAsOf.financialPeriod}`
      : null,
    response.metadata.dataAsOf.latestDisclosureDate
      ? `최근 공시 ${response.metadata.dataAsOf.latestDisclosureDate}`
      : null,
  ].filter((item): item is string => item != null);

  return (
    <View style={[styles.bubble, style]} accessibilityLabel={`AI 답변: ${response.answer}`}>
      <View style={styles.statusRow}>
        <StatusBadge label={status.label} tone={status.tone} size="sm" />
        {response.metadata.stale ? (
          <StatusBadge label="이전 캐시 포함" tone="warn" size="sm" />
        ) : null}
      </View>

      <Text style={[styles.answer, { fontFamily: font('body', '700') }]}>
        {response.answer}
      </Text>

      <PointSection title="확인되는 요인" points={response.supportingFactors} />
      <PointSection title="위험 요인" points={response.riskFactors} />
      <PointSection title="불확실성 · 추가 확인 필요" points={response.uncertainties} />

      {missing.length > 0 ? (
        <View style={styles.notice}>
          <Text style={[styles.noticeText, { fontFamily: font('body', '500') }]}>
            현재 확인되지 않은 데이터: {missing.join(', ')}
          </Text>
        </View>
      ) : null}

      {response.dataReferences.length > 0 && onOpenEvidence ? (
        <Pressable
          onPress={onOpenEvidence}
          accessibilityRole="button"
          accessibilityLabel={`참조 데이터 ${response.dataReferences.length}개 보기`}
          style={({ pressed }) => [styles.referenceButton, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.referenceText, { fontFamily: font('body', '700') }]}>
            참조 데이터 {response.dataReferences.length}개 보기
          </Text>
        </Pressable>
      ) : null}

      {response.followUpQuestion && onApplyFollowUp ? (
        <Pressable
          onPress={() => onApplyFollowUp(response.followUpQuestion!)}
          accessibilityRole="button"
          accessibilityLabel={`후속 질문 입력: ${response.followUpQuestion}`}
          style={({ pressed }) => [styles.followUp, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.followUpLabel, { fontFamily: font('body', '700') }]}>
            이어서 확인
          </Text>
          <Text style={[styles.followUpText, { fontFamily: font('body', '500') }]}>
            {response.followUpQuestion}
          </Text>
        </Pressable>
      ) : null}

      {freshness.length > 0 ? <DataMetadata items={freshness} style={styles.metadata} /> : null}
      {response.metadata.stale ? (
        <Text style={[styles.staleText, { fontFamily: font('body', '500') }]}>
          일부 데이터는 이전 캐시 기준입니다.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'stretch',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    paddingVertical: 14,
    paddingHorizontal: 15,
  },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  answer: { fontSize: 14, lineHeight: 22, color: colors.ink, marginTop: 11 },
  section: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 13, paddingTop: 11 },
  sectionTitle: { fontSize: 11.5, color: colors.mut, marginBottom: 8 },
  pointList: { gap: 9 },
  pointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginTop: 8,
  },
  pointBody: { flex: 1, minWidth: 0 },
  body: { fontSize: 13, lineHeight: 20, color: '#cdd7e8' },
  refCount: { fontSize: 10, color: colors.dim, marginTop: 3 },
  notice: {
    marginTop: 12,
    borderLeftWidth: 2,
    borderLeftColor: colors.warn,
    paddingLeft: 9,
  },
  noticeText: { fontSize: 11.5, lineHeight: 18, color: colors.mut },
  referenceButton: {
    alignSelf: 'flex-start',
    minHeight: 40,
    justifyContent: 'center',
    marginTop: 13,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.3)',
    borderRadius: 7,
    paddingHorizontal: 12,
  },
  referenceText: { fontSize: 12.5, color: colors.accent },
  followUp: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 11,
  },
  followUpLabel: { fontSize: 10.5, color: colors.accent, marginBottom: 4 },
  followUpText: { fontSize: 12.5, lineHeight: 19, color: colors.mut },
  metadata: { marginTop: 12, paddingHorizontal: 0 },
  staleText: { color: colors.warn, fontSize: 10.5, lineHeight: 16, marginTop: 4 },
});
