// Frame 25 — 알림 설정: 6종 토글. 실제 푸시 없음 — 설정값만 로컬 저장.
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { DataMetadata } from '@/components/DataMetadata';
import { SectionHeader } from '@/components/SectionHeader';
import { StaticTabBar } from '@/components/StaticTabBar';
import { ToggleSettingRow } from '@/components/ToggleSettingRow';
import { LoadingState } from '@/components/States';
import { useSafeBack } from '@/lib/useSafeBack';
import { settingsService } from '@/src/services';
import { NotificationSettings } from '@/src/types';

export default function NotificationSettingsRoute() {
  const goBack = useSafeBack('/profile');
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    settingsService.getNotificationSettings().then(s => alive.current && setSettings(s));
    return () => {
      alive.current = false;
    };
  }, []);

  const update = async (patch: Partial<NotificationSettings>) => {
    const next = await settingsService.saveNotificationSettings(patch);
    if (alive.current) setSettings(next);
  };

  if (!settings) {
    return (
      <AppScreen scroll={false} edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="home" />}>
        <LoadingState stage="알림 설정 불러오는 중" />
      </AppScreen>
    );
  }

  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="home" />}>
      <AppHeader onBack={goBack} subtitle="프로필 · 설정" title="알림 설정" />

      <SectionHeader label="알림 · Notifications" />
      <View style={styles.rows}>
        <ToggleSettingRow
          first
          title="논제 충돌 알림"
          badge="우선"
          sub="내 투자 논리와 반대되는 정보를 가장 먼저 알림"
          value={settings.contradiction}
          onChange={v => update({ contradiction: v })}
        />
        <ToggleSettingRow
          title="논제 강화 · 지표 업데이트"
          sub="가설을 지지하는 근거와 추적 지표 변화"
          value={settings.reinforcement}
          onChange={v => update({ reinforcement: v })}
        />
        <ToggleSettingRow
          title="기업 이벤트"
          sub="공시·수주·실적 등 보유/관심 종목 이벤트"
          value={settings.event}
          onChange={v => update({ event: v })}
        />
        <ToggleSettingRow
          title="시장 국면 변화"
          sub="국면 유지 확률이 크게 바뀔 때만"
          value={settings.regime}
          onChange={v => update({ regime: v })}
        />
        <ToggleSettingRow
          title="위험 경고"
          sub="논제 실패 조건 근접 · 포트폴리오 위험 변화"
          value={settings.risk}
          onChange={v => update({ risk: v })}
        />
        <ToggleSettingRow
          title="데이터 업데이트"
          sub="트윈 데이터 갱신 — 분석 없는 알림은 기본 꺼짐"
          value={settings.data}
          onChange={v => update({ data: v })}
        />
      </View>

      <DataMetadata
        items={['설정값만 로컬에 저장됩니다', '실제 푸시 알림은 P3에서 연결']}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  rows: { paddingHorizontal: 2 },
  meta: { marginTop: 12 },
});
