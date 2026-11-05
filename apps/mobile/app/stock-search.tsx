import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { EmptyState, ErrorState, LoadingState } from '@/components/States';
import { SecondaryButton } from '@/components/SecondaryButton';
import { StockSearchRow } from '@/components/StockSearchRow';
import { font } from '@/lib/fonts';
import { useSafeBack } from '@/lib/useSafeBack';
import { discoverService } from '@/src/services';
import { colors } from '@/src/theme';
import { Stock } from '@/src/types';

export default function StockSearchRoute() {
  const { q } = useLocalSearchParams<{ q?: string | string[] }>();
  const query = typeof q === 'string' ? q.trim() : '';
  const router = useRouter();
  const back = useSafeBack('/(tabs)/discover');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ query: string; results: Stock[]; status: 'loading' | 'success' | 'error' }>({
    query, results: [], status: 'loading',
  });
  useEffect(() => {
    let active = true;
    setState({ query, results: [], status: 'loading' });
    if (!query) return () => { active = false; };
    discoverService.search(query).then(results => {
      if (active) setState({ query, results, status: 'success' });
    }).catch(() => {
      if (active) setState({ query, results: [], status: 'error' });
    });
    return () => { active = false; };
  }, [query, attempt]);

  return (
    <AppScreen>
      <AppHeader title="종목 검색 결과" onBack={back} />
      <Text style={[styles.query, { fontFamily: font('body', '700') }]}>{query}</Text>
      <Text style={styles.note}>Mock 종목 데이터 내 검색 · 실제 전체 상장 종목 검색이 아닙니다.</Text>
      {!query ? <EmptyState title="검색어를 입력해 주세요" message="Discover에서 종목명이나 코드를 입력해 주세요."
        actionLabel="Discover로 돌아가기" onAction={back} /> :
        state.query !== query || state.status === 'loading' ? <LoadingState stage="Mock 종목 검색 중" /> :
          state.status === 'error' ? <ErrorState onRetry={() => setAttempt(value => value + 1)} /> : <>
            <Text style={styles.note}>검색 결과 · {state.results.length}건</Text>
            {state.results.length === 0 ? <EmptyState title="검색 결과 없음" message={`'${query}'와 일치하는 Mock 종목이 없습니다.`} /> :
              state.results.map((stock, index) => <StockSearchRow key={stock.symbol} stock={stock} divider={index > 0}
                onPress={() => router.push({ pathname: '/company/[symbol]', params: { symbol: stock.symbol } })} />)}
          </>}
      <SecondaryButton label="AI Analyst에게 질문" onPress={() => router.navigate('/(tabs)/ai')} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  query: { fontSize: 20, color: colors.ink, marginBottom: 12 },
  note: { fontSize: 13, lineHeight: 20, color: colors.mut, marginBottom: 16 },
});
