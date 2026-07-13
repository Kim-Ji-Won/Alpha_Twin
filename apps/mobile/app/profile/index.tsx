// Frame 25 — 프로필: 아바타 · 계정 · 활동 통계 · 설정 진입 · 로그아웃.
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { DataMetadata } from '@/components/DataMetadata';
import { ScoreMetric } from '@/components/ScoreMetric';
import { SectionHeader } from '@/components/SectionHeader';
import { SettingsRow } from '@/components/SettingsRow';
import { StaticTabBar } from '@/components/StaticTabBar';
import { StatusBadge } from '@/components/StatusBadge';
import { ErrorState, LoadingState } from '@/components/States';
import { useAppState } from '@/lib/appState';
import { font } from '@/lib/fonts';
import { useProfile } from '@/lib/hooks';
import { useSafeBack } from '@/lib/useSafeBack';
import { colors } from '@/src/theme';

export default function ProfileRoute() {
  const router = useRouter();
  const goBack = useSafeBack('/(tabs)/home');
  const { signOut } = useAppState();
  const { status, data, reload } = useProfile();
  const [confirmLogout, setConfirmLogout] = useState(false);

  if (status === 'loading') {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="home" />}>
        <LoadingState stage="프로필 불러오는 중" />
      </AppScreen>
    );
  }
  if (status !== 'success' || !data) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="home" />}>
        <ErrorState onRetry={reload} />
      </AppScreen>
    );
  }

  const { profile } = data;

  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="home" />}>
      <AppHeader onBack={goBack} subtitle="계정 · 설정" title="프로필" />

      {/* 아바타 + 계정 */}
      <View style={styles.account}>
        <View style={styles.avatar}>
          <Text style={[styles.avatarText, { fontFamily: font('mono', '800') }]}>
            {profile.name.slice(0, 2)}
          </Text>
        </View>
        <View style={styles.accountBody}>
          <Text style={[styles.name, { fontFamily: font('body', '800') }]}>{profile.name}</Text>
          <Text style={[styles.email, { fontFamily: font('mono', '500') }]}>
            {profile.email} · {profile.joinedAt} 가입
          </Text>
        </View>
        <StatusBadge label={profile.plan} tone="accent" />
      </View>

      {/* 활동 통계 */}
      <View style={styles.g3}>
        <ScoreMetric label="관심 트윈" value={String(data.twinCount)} valueColor={colors.ink} />
        <ScoreMetric label="논제" value={String(data.thesisCount)} valueColor={colors.ink} />
        <ScoreMetric label="보유 종목" value={String(data.holdingCount)} valueColor={colors.ink} />
      </View>

      {/* 투자 관심 산업 */}
      <SectionHeader label="관심 산업 · Interests" />
      <View style={styles.chips}>
        {profile.interests.map(i => (
          <StatusBadge key={i} label={i} tone="neutral" />
        ))}
      </View>

      <SectionHeader label="설정 · Settings" />
      <View style={styles.rows}>
        <SettingsRow
          first
          title="알림 설정"
          sub="논제 충돌 우선 · 유형별 켜고 끄기"
          onPress={() => router.push('/settings/notifications')}
        />
        <SettingsRow
          title="앱 설정"
          sub="표시 방식 · 애니메이션 · 온보딩 다시 보기"
          onPress={() => router.push('/settings')}
        />
        <SettingsRow
          title="프로필 수정"
          sub="이름·관심 산업 변경 (실계정 연동은 P3)"
          onPress={() => router.push('/settings')}
        />
      </View>

      <SectionHeader label="약관 · Legal" />
      <View style={styles.rows}>
        <SettingsRow first title="이용약관" onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })} />
        <SettingsRow title="개인정보 처리방침" onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })} />
        <SettingsRow title="투자 분석 유의사항" onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'disclaimer' } })} />
      </View>

      <View style={styles.rows}>
        <SettingsRow first muted title="로그아웃" onPress={() => setConfirmLogout(true)} />
      </View>

      <DataMetadata
        items={[`시나리오 실험 ${data.scenarioCount}회`, 'Mock 계정 · 실제 인증은 P3']}
        style={styles.meta}
      />

      <ConfirmationModal
        visible={confirmLogout}
        title="로그아웃"
        message="로그아웃하면 로그인 화면으로 돌아갑니다. 로컬에 저장된 논제·포트폴리오 기록은 유지됩니다."
        confirmLabel="로그아웃"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => {
          setConfirmLogout(false);
          signOut();
          router.replace('/auth/login');
        }}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  account: { flexDirection: 'row', alignItems: 'center', gap: 15, paddingHorizontal: 2, paddingBottom: 18 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(34,211,238,0.35)',
    backgroundColor: '#111a2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 17, fontWeight: '800', color: colors.accent },
  accountBody: { flex: 1 },
  name: { fontSize: 16.5, fontWeight: '800', color: colors.ink },
  email: { fontSize: 11.5, color: colors.dim, marginTop: 4 },
  g3: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  rows: { paddingHorizontal: 2, marginBottom: 6 },
  meta: { marginTop: 12 },
});
