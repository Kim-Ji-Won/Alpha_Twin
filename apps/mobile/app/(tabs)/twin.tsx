// Frame 24 — 관심 종목 목록(Twin 탭) 뼈대 (완성 UI는 P2)
import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { Panel } from '@/components/Panel';
import { SectionHeader } from '@/components/SectionHeader';
import { font } from '@/lib/fonts';
import { colors } from '@/src/theme';

export default function TwinTab() {
  return (
    <AppScreen edges={['top', 'left', 'right']}>
      <AppHeader subtitle="디지털 트윈" title="관심 종목" />
      <SectionHeader label="구현 예정" />
      <Panel>
        <Text style={[styles.placeholder, { fontFamily: font('body', '500') }]}>
          트윈 요약 행 · 필터 칩 · 논제 상태 · 괴리 하이라이트는 P2에서 구현됩니다. Company Twin
          상세(02)는 P1.
        </Text>
      </Panel>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  placeholder: { fontSize: 13.5, lineHeight: 21, color: colors.mut },
});
