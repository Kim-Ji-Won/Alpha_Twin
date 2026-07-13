// Frame 17 — 시스템·예외 상태 카탈로그 (개발 확인용 화면).
// 각 상태는 SystemStateCard/Loading/Error/Empty 컴포넌트로 실제 화면에서 재사용된다.
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Ellipse, Path, Polygon } from 'react-native-svg';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { DataMetadata } from '@/components/DataMetadata';
import { StaticTabBar } from '@/components/StaticTabBar';
import { SystemStateCard } from '@/components/SystemStateCard';
import { useSafeBack } from '@/lib/useSafeBack';
import { colors } from '@/src/theme';

const stroke = { strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' as const };

export default function SystemStatesRoute() {
  const router = useRouter();
  const goBack = useSafeBack('/(tabs)/home');

  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="home" />}>
      <AppHeader onBack={goBack} subtitle="개발 확인용 · Frame 17" title="System States" />

      <SystemStateCard
        progress
        icon={
          <Svg width={15} height={15} viewBox="0 0 16 16">
            <Path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11" stroke={colors.mut} {...stroke} />
          </Svg>
        }
        title="데이터 수집 중"
        description="공시·뉴스·수급 데이터를 모으고 있습니다 · 2/5 단계"
      />
      <SystemStateCard
        tone="accent"
        icon={
          <Svg width={15} height={15} viewBox="0 0 16 16">
            <Polygon points="8,1.5 14.5,8 8,14.5 1.5,8" stroke={colors.accent} {...stroke} />
          </Svg>
        }
        title="AI 분석 중"
        description="디지털 트윈을 동기화하고 있습니다. 예상 소요 40초."
        actionLabel="백그라운드로 계속"
        onAction={goBack}
      />
      <SystemStateCard
        tone="warn"
        icon={
          <Svg width={15} height={15} viewBox="0 0 16 16">
            <Ellipse cx={8} cy={4} rx={5.5} ry={2.2} stroke={colors.warn} {...stroke} />
            <Path d="M2.5 4v8c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V4" stroke={colors.warn} {...stroke} />
          </Svg>
        }
        title="데이터 부족"
        description="최근 분기 데이터가 아직 공개되지 않아 신뢰도가 낮습니다."
        actionLabel="신뢰도 낮음 · 근거 보기"
        onAction={() => router.push({ pathname: '/ai/evidence/[analysisId]', params: { analysisId: 'ans-1' } })}
      />
      <SystemStateCard
        tone="neg"
        icon={
          <Svg width={15} height={15} viewBox="0 0 16 16">
            <Path d="M8 2L14.5 13.5h-13z M8 7v3M8 11.8v.2" stroke={colors.neg} {...stroke} />
          </Svg>
        }
        title="분석 실패"
        description="일시적 오류로 분석을 완료하지 못했습니다. 마지막 성공 결과(06/28)를 대신 표시합니다."
        actionLabel="다시 시도"
        onAction={goBack}
      />
      <SystemStateCard
        icon={
          <Svg width={15} height={15} viewBox="0 0 16 16">
            <Circle cx={8} cy={8} r={6} stroke={colors.mut} {...stroke} />
            <Path d="M8 4.5V8l2.5 1.5" stroke={colors.mut} {...stroke} />
          </Svg>
        }
        title="오래된 데이터"
        description="기준 시점 06/21 · 15일 경과. 최신 상태와 다를 수 있습니다."
        actionLabel="지금 업데이트"
        onAction={goBack}
      />
      <SystemStateCard
        icon={
          <Svg width={15} height={15} viewBox="0 0 16 16">
            <Path d="M8 8V2.6A5.4 5.4 0 1 1 2.6 8z M8 8l5.1-1.7" stroke={colors.mut} {...stroke} />
          </Svg>
        }
        title="빈 포트폴리오"
        description="보유 종목을 추가하면 X-Ray가 숨은 공통 위험을 분석합니다."
        actionLabel="종목 추가하기"
        onAction={() => router.push('/portfolio/add')}
      />
      <SystemStateCard
        icon={
          <Svg width={15} height={15} viewBox="0 0 16 16">
            <Circle cx={7} cy={7} r={4.2} stroke={colors.mut} {...stroke} />
            <Path d="M10.2 10.2L14 14" stroke={colors.mut} {...stroke} />
          </Svg>
        }
        title="검색 결과 없음"
        description="'HBM4 수혜'와 일치하는 종목이 없습니다. 자연어로 질문해 보세요."
        actionLabel="AI Analyst에게 질문"
        onAction={() => router.navigate('/(tabs)/ai')}
      />
      <SystemStateCard
        tone="warn"
        icon={
          <Svg width={15} height={15} viewBox="0 0 16 16">
            <Path
              d="M6.5 9.5a3 3 0 0 0 4.2.3l2-2a3 3 0 0 0-4.2-4.2l-1 1M9.5 6.5a3 3 0 0 0-4.2-.3l-2 2a3 3 0 0 0 4.2 4.2l1-1"
              stroke={colors.warn}
              {...stroke}
            />
          </Svg>
        }
        title="추정 데이터 표시"
        description="해당 공급망 관계는 공개 자료 기반 추정입니다. 원문 근거를 확인하세요."
        actionLabel="근거 보기"
        onAction={() => router.push({ pathname: '/ai/evidence/[analysisId]', params: { analysisId: 'ans-1' } })}
      />
      <SystemStateCard
        icon={
          <Svg width={15} height={15} viewBox="0 0 16 16">
            <Path d="M2 12.5c2-1 3-6 6-6s4 5 6 4M2 3.5v10h12" stroke={colors.mut} {...stroke} />
          </Svg>
        }
        title="부분 분석"
        description="뉴스 이벤트의 실제 재무 영향은 아직 확인되지 않았습니다."
        actionLabel="분석 범위 상세"
        onAction={goBack}
      />

      <DataMetadata
        items={['공통 규칙 — 불확실성을 숨기지 않고 표시 · 항상 다음 행동 제시 · 실패 시 마지막 성공 결과 유지']}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  meta: { marginTop: 4 },
});
