import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { DataMetadata, formatAsOf } from '@/components/DataMetadata';
import { Panel } from '@/components/Panel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SectionHeader } from '@/components/SectionHeader';
import { StaticTabBar } from '@/components/StaticTabBar';
import { EmptyState } from '@/components/States';
import { StatusBadge } from '@/components/StatusBadge';
import { font } from '@/lib/fonts';
import { useSafeBack } from '@/lib/useSafeBack';
import { getAiAnalysisSession } from '@/src/services/aiService';
import { colors } from '@/src/theme';
import { AiDataReferenceDto } from '@/src/types/ai';
import { CanonicalFinancialMetric } from '@/src/types/companyTwin';

const SOURCE_LABEL: Record<AiDataReferenceDto['sourceType'], string> = {
  market: '시세',
  profile: '기업개황',
  financial: '재무',
  disclosure: '공시',
};

const METRIC_LABEL: Record<CanonicalFinancialMetric, string> = {
  totalAssets: '자산총계',
  totalLiabilities: '부채총계',
  totalEquity: '자본총계',
  cashAndCashEquivalents: '현금 및 현금성자산',
  revenue: '매출액',
  operatingIncome: '영업이익',
  netIncome: '당기순이익',
  operatingCashFlow: '영업활동현금흐름',
};

function ReferenceCard({ reference }: { reference: AiDataReferenceDto }) {
  const details: string[] = [];
  if (reference.sourceType === 'financial') {
    details.push(METRIC_LABEL[reference.metric], reference.period);
  }
  if (reference.sourceType === 'disclosure') {
    details.push(reference.reportName, `접수일 ${reference.receiptDate}`);
  }
  if (reference.asOf) details.push(`기준 ${formatAsOf(reference.asOf)}`);

  return (
    <Panel style={styles.referenceCard}>
      <View style={styles.referenceHead}>
        <StatusBadge label={SOURCE_LABEL[reference.sourceType]} tone="accent" size="sm" />
        <Text style={[styles.referenceId, { fontFamily: font('mono', '500') }]}>
          {reference.id}
        </Text>
      </View>
      <Text style={[styles.referenceLabel, { fontFamily: font('body', '700') }]}>
        {reference.label}
      </Text>
      {details.length > 0 ? <DataMetadata items={details} style={styles.referenceMeta} /> : null}
    </Panel>
  );
}

export default function EvidenceRoute() {
  const router = useRouter();
  const { analysisId } = useLocalSearchParams<{ analysisId: string }>();
  const goBack = useSafeBack('/(tabs)/ai');
  const session = getAiAnalysisSession(analysisId ?? '');

  if (!session) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="ai" />}>
        <AppHeader onBack={goBack} subtitle="AI Analyst" title="참조 데이터" />
        <EmptyState
          title="참조 세션이 만료되었습니다"
          message="참조 데이터를 다시 확인하려면 AI 분석 화면에서 새 분석을 실행해주세요."
          actionLabel="AI Analyst로 돌아가기"
          onAction={() => router.replace('/(tabs)/ai')}
        />
      </AppScreen>
    );
  }

  const { response } = session;
  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="ai" />}>
      <AppHeader onBack={goBack} subtitle={`${session.companyName} · ${session.symbol}`} title="참조 데이터" />

      <Panel>
        <SectionHeader label="분석 기준 · Basis" style={styles.panelHeader} />
        <Text style={[styles.question, { fontFamily: font('body', '600') }]}>
          Q. {session.question}
        </Text>
        <Text style={[styles.answer, { fontFamily: font('body', '700') }]}>
          {response.answer}
        </Text>
        <Text style={[styles.explainer, { fontFamily: font('body', '500') }]}>
          이 화면은 AI 분석에 사용된 구조화 데이터 참조를 보여줍니다. 공시 본문 원문 인용은
          현재 제공하지 않습니다.
        </Text>
      </Panel>

      <SectionHeader label={`참조 데이터 ${response.dataReferences.length}개`} />
      {response.dataReferences.length > 0 ? (
        response.dataReferences.map(reference => (
          <ReferenceCard key={reference.id} reference={reference} />
        ))
      ) : (
        <Panel>
          <Text style={[styles.emptyReferences, { fontFamily: font('body', '500') }]}>
            이 답변에 연결된 구조화 데이터 참조가 없습니다.
          </Text>
        </Panel>
      )}

      <PrimaryButton
        label={`${session.companyName} Company Twin`}
        onPress={() =>
          router.push({ pathname: '/company/[symbol]', params: { symbol: session.symbol } })
        }
        style={styles.companyButton}
      />

      <DataMetadata
        items={[
          `생성 ${formatAsOf(response.metadata.generatedAt)}`,
          'ALPHA TWIN 백엔드 구조화 데이터',
          '투자 권유나 수익 보장이 아닙니다',
        ]}
        style={styles.footer}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  panelHeader: { marginTop: 0, marginBottom: 0 },
  question: { fontSize: 12.5, lineHeight: 19, color: colors.mut, marginTop: 9 },
  answer: { fontSize: 13.5, lineHeight: 21, color: colors.ink, marginTop: 7 },
  explainer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    color: colors.dim,
    fontSize: 11.5,
    lineHeight: 18,
    marginTop: 12,
    paddingTop: 11,
  },
  referenceCard: { marginBottom: 9 },
  referenceHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  referenceId: { flex: 1, color: colors.dim, fontSize: 9.5, textAlign: 'right' },
  referenceLabel: { color: colors.ink, fontSize: 13.5, lineHeight: 20, marginTop: 10 },
  referenceMeta: { marginTop: 7, paddingHorizontal: 0 },
  emptyReferences: { color: colors.mut, fontSize: 13, lineHeight: 20 },
  companyButton: { marginTop: 5 },
  footer: { marginTop: 14 },
});
