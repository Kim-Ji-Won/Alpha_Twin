// Frame 08 — Discover 뼈대 (완성 UI는 P2)
import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { Panel } from '@/components/Panel';
import { SectionHeader } from '@/components/SectionHeader';
import { font } from '@/lib/fonts';
import { colors } from '@/src/theme';

export default function DiscoverTab() {
  return (
    <AppScreen edges={['top', 'left', 'right']}>
      <AppHeader subtitle="탐색" title="Discover" />
      <SectionHeader label="구현 예정" />
      <Panel>
        <Text style={[styles.placeholder, { fontFamily: font('body', '500') }]}>
          종목 검색 · 자연어 질문 칩 · 이상 신호 · 산업 트윈 · Narrative Gap은 P2에서 구현됩니다.
        </Text>
      </Panel>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  placeholder: { fontSize: 13.5, lineHeight: 21, color: colors.mut },
});
