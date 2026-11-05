import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { font } from '@/lib/fonts';
import { useAsync } from '@/lib/useAsync';
import { useSafeBack } from '@/lib/useSafeBack';
import { discoverService } from '@/src/services';
import { colors } from '@/src/theme';

export default function NarrativeGapDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const goBack = useSafeBack('/(tabs)/discover');
  const { status, data, reload } = useAsync(() => discoverService.getNarrativeGaps(), []);
  const item = typeof id === 'string' ? data?.find(entry => entry.id === id) : undefined;

  return (
    <AppScreen>
      <AppHeader title="기대와 실제" subtitle="Narrative Gap" onBack={goBack} />
      {status === 'loading' ? <LoadingState stage="Mock 데이터 불러오는 중" /> :
        status === 'error' ? <ErrorState onRetry={reload} /> :
          !item ? <EmptyState title="항목을 찾을 수 없어요" message="선택한 Mock 항목이 없습니다."
            actionLabel="Discover로 돌아가기" onAction={goBack} /> : (
            <View style={styles.content}>
              <Text accessibilityRole="header" style={[styles.name, { fontFamily: font('body', '700') }]}>{item.label}</Text>
              <View style={styles.notice}>
                <Text style={[styles.mock, { fontFamily: font('body', '700') }]}>Mock 데이터</Text>
                <Text style={[styles.body, { fontFamily: font('body', '500') }]}>
                  실제 공시·뉴스를 분석해 산출한 점수가 아닙니다
                </Text>
              </View>
              <View style={styles.metric}>
                <Text style={[styles.label, { fontFamily: font('body', '600') }]}>Narrative Score</Text>
                <Text style={[styles.score, { fontFamily: font('mono', '600') }]}>{item.narrativeScore}점</Text>
              </View>
              <View style={styles.metric}>
                <Text style={[styles.label, { fontFamily: font('body', '600') }]}>Revenue Evidence</Text>
                <Text style={[styles.score, { fontFamily: font('mono', '600') }]}>{item.revenueEvidence}점</Text>
              </View>
              <Text style={[styles.body, { fontFamily: font('body', '500') }]}>
                Discover 요약의 앞 숫자는 Narrative Score, 뒤 숫자는 Revenue Evidence입니다.
                기대와 실적 근거를 비교하는 예시이며, 실제 기업 평가나 투자 판단의 근거가 아닙니다.
              </Text>
            </View>
          )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 20 },
  name: { fontSize: 22, color: colors.ink },
  notice: { gap: 8, borderLeftWidth: 3, borderLeftColor: colors.warn, paddingLeft: 12 },
  mock: { fontSize: 15, color: colors.warn },
  body: { fontSize: 15, lineHeight: 24, color: colors.mut },
  metric: { gap: 8, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  label: { fontSize: 16, color: colors.ink },
  score: { fontSize: 28, color: colors.accent },
});
