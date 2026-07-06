# ALPHA TWIN — 개발 인계 패키지

> **⚠️ 지원 범위 (정직 고지)**: 이 패키지는 디자인 도구 환경에서 제작되어 **실행 가능한 Expo 프로젝트 전체를 포함하지 않습니다**. 검증 없이 생성된 RN 화면 코드를 "동작한다"고 넘기는 대신, Claude Code가 기계적으로 앱을 생성할 수 있도록 **디자인 원본(HTML) + 디자인 토큰(.ts) + 도메인 타입(.ts) + Mock Data(.ts) + 서비스 계층(.ts) + 내비 구조 + 화면·컴포넌트 명세**를 완전하게 제공합니다. 이 .ts 파일들은 Expo 프로젝트에 그대로 복사해 쓰는 실제 소스입니다.

## 1. 프로젝트 소개
ALPHA TWIN — 상장기업을 데이터 기반 디지털 트윈으로 구현하는 AI 투자 인텔리전스 모바일 앱. 핵심: 정확한 데이터, 설명 가능한 AI, 직접 실험하는 미래 시나리오. 상세 브랜드/기능 정의는 HANDOFF.md와 design/ 참조.

## 2. 목표 기술 스택
React Native + Expo + TypeScript + Expo Router (iOS/Android). 차트: react-native-svg (+ react-native-gesture-handler, react-native-reanimated). 폰트: Pretendard, JetBrains Mono (expo-font 또는 expo-google-fonts).

## 3. Claude Code에서 시작하는 방법
```bash
# 1) 프로젝트 생성
npx create-expo-app@latest alpha-twin --template tabs   # TypeScript + Expo Router
cd alpha-twin
npx expo install react-native-svg react-native-gesture-handler react-native-reanimated expo-font

# 2) 이 패키지의 src/ 를 프로젝트에 복사
cp -r ../alpha-twin-handoff/src ./src
cp -r ../alpha-twin-handoff/assets ./assets/brand

# 3) 실행
npm install && npx expo start
```
그 다음 Claude Code에 지시: "HANDOFF.md와 design/Alpha Twin.dc.html을 참조해서 specs/components.md의 컴포넌트를 구현하고, src/constants/navigation.ts의 라우트 구조대로 화면을 만들어줘. 데이터는 반드시 src/services를 통해서만 가져와."

## 4. 폴더 구조
```
alpha-twin-handoff/
├── README.md              ← 이 문서
├── HANDOFF.md             ← 화면별 목적·이동·인터랙션·주의사항
├── TODO.md                ← 미구현 항목
├── design/
│   ├── Alpha Twin.dc.html ← 디자인 원본 (27프레임, 브라우저로 열기)
│   └── support.js         ← 원본 뷰어 런타임
├── specs/
│   └── components.md      ← 공통 컴포넌트 Props 계약
├── assets/
│   ├── logo.svg           ← 브랜드 마크
│   ├── app-icon.svg       ← 앱 아이콘 1024 원본
│   └── app-icon-small.svg ← 29pt용 단순화 버전
└── src/                   ← Expo 프로젝트에 그대로 복사하는 실소스
    ├── theme/             ← colors/typography/spacing/radius/shadows
    ├── types/index.ts     ← 14개 도메인 타입 전부
    ├── mocks/             ← 디자인 프레임과 1:1 일치하는 Mock Data
    ├── services/          ← Mock 반환 서비스 계층 (API 교체 지점)
    └── constants/navigation.ts ← 탭 5개 + 전체 라우트 + 필수 플로우
```

## 5. 전체 화면 목록 (27프레임)
SYSTEM 디자인시스템 · 01 Market Brain · 02 Company Twin · 03/04 Scenario 입력/결과 · 05 Thesis OS · 06 Portfolio X-Ray · 07 AI Analyst · 08 Discover · 09 알림 센터 · 10 스플래시 · 11–13 온보딩 · 14 앱 아이콘 · 15 Management Track Record · 16 차트 라이브러리 · 17 예외 상태 9종(수집 중/분석 중/데이터 부족/실패/오래됨/빈 포트폴리오/검색 없음/추정/부분 분석) · 18 로그인 · 19 관심 산업·종목 선택 · 20 종목 추가 · 21 논제 작성 · 22 논제 변경 기록 · 23 AI 근거 상세 · 24 관심 종목 목록 · 25 프로필·설정·알림 설정 · 26 내비게이션 맵

## 6. 내비게이션
`src/constants/navigation.ts` + 프레임 26 참조. 하단 탭: Home/Discover/Twin/Portfolio/AI. Scenario Lab은 Home·CompanyTwin·Portfolio 3곳에서 진입.

## 7. 디자인 시스템
`src/theme/` — 화면 코드에 hex/px 직접 쓰지 말고 토큰만 사용. 규칙 요약: 다크 네이비 단일 배경, 보더+반투명으로 깊이, 숫자는 전부 JetBrains Mono tabular, 상태는 색+기호+텍스트 삼중 표기, 그라디언트는 primary 버튼과 브랜드 요소만.

## 8. Mock Data와 API 연결
- Mock: `src/mocks/` — 디자인 화면의 수치와 1:1 일치 (SK하이닉스 상태 74, 논제 78 등). 임의 변경 금지
- 화면은 `src/services/`만 호출. API 연결 = 서비스 메서드 본문 교체 (HANDOFF.md 교체 표 참조)

## 9. 현재 동작하는 것 / 안 하는 것
- **이 패키지에서 동작**: theme/types/mocks/services는 완결된 TS 소스 (외부 의존성 없음, RN 불필요)
- **Claude Code에서 구현 필요**: 화면 JSX, 차트 컴포넌트, 내비게이션 연결, 폰트 로딩, 애니메이션 — TODO.md 참조

## 10. 검수 체크리스트 (구현 후)
Safe Area / 긴 화면 스크롤 / 키보드 회피(KeyboardAvoidingView) / 탭·버튼 실동작 / 로딩·오류·빈 상태 / 접근성 label / TS 오류 0 / 작은 화면(SE) 잘림 없음
