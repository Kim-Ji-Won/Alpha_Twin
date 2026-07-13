// P2 — 앱 설정: 표시 방식 · 애니메이션(Reduce Motion 연동) · 버전 · 온보딩 다시 보기 · 로그아웃.
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { DataMetadata } from '@/components/DataMetadata';
import { SectionHeader } from '@/components/SectionHeader';
import { SettingsRow } from '@/components/SettingsRow';
import { StaticTabBar } from '@/components/StaticTabBar';
import { ToggleSettingRow } from '@/components/ToggleSettingRow';
import { LoadingState } from '@/components/States';
import { useAppState } from '@/lib/appState';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useSafeBack } from '@/lib/useSafeBack';
import { settingsService } from '@/src/services';
import { AppSettings } from '@/src/types';

const COLOR_MODE_LABEL: Record<AppSettings['changeColorMode'], string> = {
  international: '국제형',
  korean: '국내형',
};
const UNIT_LABEL: Record<AppSettings['numberUnit'], string> = { won: '원 단위', manwon: '만원 단위' };
const RETURN_LABEL: Record<AppSettings['returnDisplay'], string> = { pct: '수익률 %', amount: '평가손익 금액' };

export default function SettingsRoute() {
  const router = useRouter();
  const goBack = useSafeBack('/profile');
  const { signOut, resetOnboarding } = useAppState();
  const reducedMotion = useReducedMotion();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    settingsService.getAppSettings().then(s => alive.current && setSettings(s));
    return () => {
      alive.current = false;
    };
  }, []);

  const update = async (patch: Partial<AppSettings>) => {
    const next = await settingsService.saveAppSettings(patch);
    if (alive.current) setSettings(next);
  };

  if (!settings) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="home" />}>
        <LoadingState stage="설정 불러오는 중" />
      </AppScreen>
    );
  }

  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="home" />}>
      <AppHeader onBack={goBack} subtitle="프로필 · 설정" title="앱 설정" />

      <SectionHeader label="표시 · Display" />
      <View style={styles.rows}>
        <SettingsRow
          first
          title="등락 색상"
          sub="상승 에메랄드 · 하락 레드 (색+기호 병행)"
          value={COLOR_MODE_LABEL[settings.changeColorMode]}
          onPress={() =>
            update({
              changeColorMode: settings.changeColorMode === 'international' ? 'korean' : 'international',
            })
          }
        />
        <SettingsRow
          title="숫자 단위"
          sub="평가액·금액 표시 단위"
          value={UNIT_LABEL[settings.numberUnit]}
          onPress={() => update({ numberUnit: settings.numberUnit === 'won' ? 'manwon' : 'won' })}
        />
        <SettingsRow
          title="수익률 표시"
          sub="보유 종목 수익 표시 방식"
          value={RETURN_LABEL[settings.returnDisplay]}
          onPress={() => update({ returnDisplay: settings.returnDisplay === 'pct' ? 'amount' : 'pct' })}
        />
        <SettingsRow title="언어" sub="한국어 · 다른 언어는 준비 중" value="한국어" />
      </View>

      <SectionHeader label="모션 · Motion" />
      <View style={styles.rows}>
        <ToggleSettingRow
          first
          title="애니메이션 사용"
          sub={
            reducedMotion
              ? '시스템 Reduce Motion이 켜져 있어 장식 애니메이션은 자동으로 꺼집니다'
              : '펄스·전환 등 장식 애니메이션'
          }
          value={settings.animationsEnabled && !reducedMotion}
          disabled={reducedMotion}
          onChange={v => update({ animationsEnabled: v })}
        />
      </View>

      <SectionHeader label="앱 · App" />
      <View style={styles.rows}>
        <SettingsRow
          first
          title="온보딩 다시 보기"
          sub="핵심 가치 3장면을 다시 봅니다"
          onPress={() => {
            resetOnboarding();
            router.push('/onboarding');
          }}
        />
        <SettingsRow
          title="앱 버전"
          sub={`ALPHA TWIN ${Constants.expoConfig?.version ?? '1.0.0'} · Mock 개발 버전`}
        />
        <SettingsRow muted title="로그아웃" onPress={() => setConfirmLogout(true)} />
      </View>

      <DataMetadata
        items={['설정은 이 기기에만 저장됩니다', '클라우드 동기화는 P3']}
        style={styles.meta}
      />

      <ConfirmationModal
        visible={confirmLogout}
        title="로그아웃"
        message="로그아웃하면 로그인 화면으로 돌아갑니다. 로컬 기록은 유지됩니다."
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
  rows: { paddingHorizontal: 2, marginBottom: 6 },
  meta: { marginTop: 12 },
});
