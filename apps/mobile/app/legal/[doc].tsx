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
      '1. 기기에 저장하는 정보 — 앱·알림 설정, 관심 종목, 작성한 투자 논제와 보유 종목 기록 등은 기기의 로컬 저장소에 저장합니다. 실제 계좌와 연결된 기록은 아닙니다.',
      '2. AI Analyst 이용 시 전송 — 백엔드 연결이 설정된 상태에서 질문을 보내면 선택한 종목 코드, 질문, 대화 맥락을 위한 최근 대화 일부가 백엔드로 전송됩니다. 최근 대화는 완료된 질문과 AI 답변 중 최대 6개 메시지이며 길이 제한이 적용됩니다. 질문에 개인정보나 민감한 내용을 입력하지 마세요.',
      '3. 외부 AI 처리 — 서버의 OpenAI 연결 설정이 갖춰지고 분석 요청이 처리되는 경우, 질문·포함된 최근 대화와 서버가 구성한 기업 식별 정보, 시세·기업개황·재무 요약·공시 목록 정보, 참조 ID를 OpenAI에 보내 답변을 생성합니다. 공시 목록 정보는 제목·접수번호 등의 메타데이터이며 공시 본문 검색과는 구분됩니다.',
      '4. 계정 정보 — 현재 로그인은 개발용 로컬 상태 처리이며 프로필의 이름·이메일은 예시 데이터입니다. 실제 계정 생성에 따른 이름·이메일 수집 기능이 구현된 것으로 안내하지 않습니다.',
      '5. 보관·삭제 안내 — 로그아웃은 로그인 상태를 변경하는 기능이며 모든 기록을 삭제하는 기능이 아닙니다. 실제 계정 삭제·일괄 파기 절차와 외부 서비스의 보관 기간은 이 개발용 문안에서 보장하지 않습니다. 운영 배포 전에 처리 항목·보관 기간·삭제 절차를 확정해 안내해야 합니다.',
    ],
  },
  disclaimer: {
    title: '투자 분석 유의사항',
    paragraphs: [
      '1. 본 서비스의 모든 분석 결과(기업 상태 점수, 확률 분포, 시나리오 결과, AI 답변 등)는 투자 자문이 아니며, 특정 종목의 매수·매도를 권유하지 않습니다.',
      '2. 분석 결과는 확률적 추정이며 미래 수익을 보장하지 않습니다. 확률은 항상 범위로 해석해야 합니다.',
      '3. 데이터는 수집·처리 과정에서 지연되거나 부정확할 수 있습니다. 모든 화면의 데이터 기준 시각(asOf)을 확인하세요.',
      '4. 최종 투자 판단과 그 결과에 대한 책임은 이용자 본인에게 있습니다.',
      '5. 현재 앱은 개발 버전입니다. 연결 설정에 따라 Company Twin에서 최근 확정 시세와 OpenDART 기업·공시·재무 데이터를 조회하고, AI Analyst에서 서버를 통한 AI 답변을 받을 수 있습니다. 연결 상태·데이터 출처와 기준 시각을 확인하세요. Mock으로 표시된 점수·예측·시나리오 화면은 예시이며 실제 분석 결과가 아닙니다. 준비 중인 분석 기능과 실제 데이터 조회·AI 답변은 구분해야 합니다.',
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
        items={['임시 문안 — 운영 배포 전 법률 검토 필요', '개발 버전 · 실제 데이터·AI 연동과 Mock 예시 혼재']}
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
