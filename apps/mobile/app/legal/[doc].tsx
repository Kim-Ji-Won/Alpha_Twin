// P2 — 약관/개인정보/투자 유의사항 텍스트 화면.
// NOTE: 아래 문안은 개발용 임시 문안이다. 운영 배포 전 법률 검토를 거친 최종 문안으로 교체해야 한다.
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { AppScreen } from '@/components/AppScreen';
import { DataMetadata } from '@/components/DataMetadata';
import { Panel } from '@/components/Panel';
import { StaticTabBar } from '@/components/StaticTabBar';
import { font } from '@/lib/fonts';
import { useSafeBack } from '@/lib/useSafeBack';
import { colors } from '@/src/theme';

const DOCS: Record<string, { title: string; paragraphs: string[] }> = {
  terms: {
    title: '이용약관',
    paragraphs: [
      '제1조 (목적) 이 약관은 ALPHA TWIN(이하 "서비스")의 이용 조건과 절차, 이용자와 서비스 제공자의 권리·의무를 정합니다.',
      '제2조 (서비스 성격) 본 서비스는 기업·시장 데이터를 기반으로 한 분석 보조 도구이며, 투자 자문·일임·중개 서비스가 아닙니다.',
      '제3조 (계정) 이용자는 본인의 계정 정보를 안전하게 관리할 책임이 있으며, 타인에게 양도할 수 없습니다.',
      '제4조 (서비스 변경) 서비스의 기능·데이터 범위는 개선 과정에서 예고 후 변경될 수 있습니다.',
      '제5조 (책임 제한) 서비스가 제공하는 분석 결과의 활용과 그에 따른 투자 판단·결과의 책임은 이용자에게 있습니다.',
    ],
  },
  privacy: {
    title: '개인정보 처리방침',
    paragraphs: [
      '1. 수집 항목 — 계정 생성 시 이름, 이메일을 수집합니다. 관심 산업·종목, 투자 논제, 보유 종목 기록은 서비스 제공 목적으로만 사용됩니다.',
      '2. 보관 위치 — 현재 개발 버전은 모든 기록을 이용자 기기(로컬 저장소)에만 보관하며, 서버로 전송하지 않습니다.',
      '3. 이용 목적 — 개인화된 분석 화면 구성(포트폴리오 X-Ray, 논제 감시, 맞춤 알림)에만 사용합니다.',
      '4. 제3자 제공 — 이용자의 동의 없이 개인정보를 제3자에게 제공하지 않습니다.',
      '5. 파기 — 계정 삭제 또는 앱 삭제 시 기기에 저장된 정보는 함께 삭제됩니다.',
    ],
  },
  disclaimer: {
    title: '투자 분석 유의사항',
    paragraphs: [
      '1. 본 서비스의 모든 분석 결과(기업 상태 점수, 확률 분포, 시나리오 결과, AI 답변 등)는 투자 자문이 아니며, 특정 종목의 매수·매도를 권유하지 않습니다.',
      '2. 분석 결과는 확률적 추정이며 미래 수익을 보장하지 않습니다. 확률은 항상 범위로 해석해야 합니다.',
      '3. 데이터는 수집·처리 과정에서 지연되거나 부정확할 수 있습니다. 모든 화면의 데이터 기준 시각(asOf)을 확인하세요.',
      '4. 최종 투자 판단과 그 결과에 대한 책임은 이용자 본인에게 있습니다.',
      '5. 현재 앱은 개발 버전입니다. Company Twin 시세는 설정에 따라 최근 확정 공공데이터 또는 Mock Data를 사용하며, 재무·뉴스·분석 기능은 Mock Data입니다.',
    ],
  },
};

export default function LegalRoute() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const goBack = useSafeBack('/profile');
  const content = DOCS[doc ?? ''] ?? DOCS.terms;

  return (
    <AppScreen edges={['top', 'left', 'right']} tabBar={<StaticTabBar active="home" />}>
      <AppHeader onBack={goBack} subtitle="약관 · Legal" title={content.title} />
      <Panel>
        {content.paragraphs.map((p, i) => (
          <Text
            key={i}
            style={[styles.paragraph, i > 0 && styles.gap, { fontFamily: font('body', '500') }]}>
            {p}
          </Text>
        ))}
      </Panel>
      <DataMetadata
        items={['임시 문안 — 운영 배포 전 법률 검토 필요', 'Mock Data 기반 개발 버전']}
        style={styles.meta}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  paragraph: { fontSize: 13.5, lineHeight: 22, color: '#b8c4da' },
  gap: { marginTop: 12 },
  meta: { marginTop: 2 },
});
