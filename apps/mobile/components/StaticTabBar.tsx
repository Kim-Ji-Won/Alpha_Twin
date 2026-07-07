// 상세 화면(Company Twin·Scenario·Thesis OS) 하단 상주 탭 바.
// 디자인 프레임 02–05: 상세 화면에도 nav가 있고 Twin 탭이 활성 표시.
// 탭을 누르면 해당 탭 루트로 이동 (뒤로 가기 스택은 유지).
import { useRouter } from 'expo-router';
import React from 'react';
import { TabBarView, TabName } from '@/components/BottomTabBar';

const TAB_HREF = {
  home: '/(tabs)/home',
  discover: '/(tabs)/discover',
  twin: '/(tabs)/twin',
  portfolio: '/(tabs)/portfolio',
  ai: '/(tabs)/ai',
} as const;

export interface StaticTabBarProps {
  /** 활성 표시할 탭 — 분석 상세 화면은 디자인상 'twin' */
  active?: TabName;
}

export function StaticTabBar({ active = 'twin' }: StaticTabBarProps) {
  const router = useRouter();
  return <TabBarView activeName={active} onNavigate={name => router.navigate(TAB_HREF[name])} />;
}
