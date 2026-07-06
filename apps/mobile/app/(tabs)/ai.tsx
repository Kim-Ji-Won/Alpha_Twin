// Frame 07 — AI Analyst 뼈대 (완성 UI는 P2)
import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { Panel } from '@/components/Panel';
import { SectionHeader } from '@/components/SectionHeader';
import { font } from '@/lib/fonts';
import { colors } from '@/src/theme';

export default function AiTab() {
  return (
    <AppScreen edges={['top', 'left', 'right']}>
      <AppHeader subtitle="근거 기반 Q&A" title="AI Analyst" />
      <SectionHeader label="구현 예정" />
      <Panel>
        <Text style={[styles.placeholder, { fontFamily: font('body', '500') }]}>
          결론/근거/반대 말풍선 · 근거 칩 행 · AIComposer · 근거 상세(23)는 P2에서 구현됩니다.
          실제 AI 연동은 P3.
        </Text>
      </Panel>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  placeholder: { fontSize: 13.5, lineHeight: 21, color: colors.mut },
});
