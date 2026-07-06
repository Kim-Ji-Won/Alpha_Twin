// Frame 01 — Market Brain 뼈대 (P0: 헤더 + 서비스 연동 확인용 최소 구조, 완성 UI는 P1)
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { Panel } from '@/components/Panel';
import { SectionHeader } from '@/components/SectionHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { font } from '@/lib/fonts';
import { colors } from '@/src/theme';
import { marketService } from '@/src/services';
import { MarketRegime } from '@/src/types';

export default function HomeTab() {
  const [regime, setRegime] = useState<MarketRegime | null>(null);

  // 서비스 계층 경유 데이터 흐름 확인 (Mock, HANDOFF 규칙: 화면은 services만 호출)
  useEffect(() => {
    marketService.getRegime().then(setRegime);
  }, []);

  return (
    <AppScreen edges={['top', 'left', 'right']}>
      <AppHeader subtitle="ALPHA TWIN" title="Market Brain" live />
      <SectionHeader label="오늘의 시장 국면" meta={regime ? `asOf ${regime.asOf.slice(0, 10)}` : '로딩 중'} />
      <Panel>
        {regime ? (
          <View style={styles.regimeRow}>
            <View style={styles.regimeText}>
              <Text style={[styles.regimeLabel, { fontFamily: font('body', '800') }]}>
                {regime.label}
              </Text>
              <Text style={[styles.regimeMeta, { fontFamily: font('mono', '500') }]}>
                유지 확률 {Math.round(regime.probability * 100)}% · {regime.sentiment}
              </Text>
            </View>
            <StatusBadge label={`위험 ${regime.riskLevel === 'medium' ? '보통' : regime.riskLevel === 'high' ? '높음' : '낮음'}`} tone="warn" size="sm" />
          </View>
        ) : (
          <Text style={[styles.placeholder, { fontFamily: font('body', '500') }]}>
            트윈 동기화 중…
          </Text>
        )}
      </Panel>

      <SectionHeader label="구현 예정" />
      <Panel>
        <Text style={[styles.placeholder, { fontFamily: font('body', '500') }]}>
          국면 히어로 · 포트폴리오 영향 알림 · EventTimeline · 수급/산업 FoldRow는 P1에서
          구현됩니다.
        </Text>
      </Panel>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  regimeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  regimeText: { flex: 1 },
  regimeLabel: { fontSize: 17, fontWeight: '800', color: colors.ink },
  regimeMeta: { fontSize: 11, color: colors.mut, marginTop: 5 },
  placeholder: { fontSize: 13.5, lineHeight: 21, color: colors.mut },
});
