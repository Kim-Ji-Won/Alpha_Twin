// Frame 06 — Portfolio X-Ray 뼈대 (완성 UI는 P2)
import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { Panel } from '@/components/Panel';
import { SectionHeader } from '@/components/SectionHeader';
import { font } from '@/lib/fonts';
import { colors } from '@/src/theme';

export default function PortfolioTab() {
  return (
    <AppScreen edges={['top', 'left', 'right']}>
      <AppHeader subtitle="숨은 공통 위험" title="Portfolio X-Ray" />
      <SectionHeader label="구현 예정" />
      <Panel>
        <Text style={[styles.placeholder, { fontFamily: font('body', '500') }]}>
          위험 요인 RiskBar · 중첩 지도 NetworkGraph · AllocationBar · 종목 추가/수정/삭제는
          P2에서 구현됩니다.
        </Text>
      </Panel>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  placeholder: { fontSize: 13.5, lineHeight: 21, color: colors.mut },
});
