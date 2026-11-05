# ALPHA TWIN Mobile

React Native와 Expo Router로 구현한 모바일 앱입니다. 앱 실행 소스는 이 디렉터리에 있으며, 루트의 디자인·인계 자료와 구분합니다.

## 기술 스택

| 영역 | 기술 |
| --- | --- |
| 앱 기반 | Expo SDK 57 · React Native 0.86 · React 19.2 · TypeScript |
| 탐색·저장 | Expo Router · AsyncStorage |
| 그래프·모션 | React Native SVG · Reanimated · Gesture Handler |
| 접근성·폰트 | Safe Area Context · Reduce Motion · Pretendard · JetBrains Mono |

## 실행

저장소 루트에서:

```bash
cd apps/mobile
npm ci
EXPO_PUBLIC_ALPHA_TWIN_API_BASE_URL=http://127.0.0.1:4000 npx expo start
```

백엔드는 별도 터미널에서 실행합니다. 자세한 서버 설정은 [API README](../api/README.md)를 참고하세요.

| 실행 대상 | API 주소 안내 |
| --- | --- |
| 같은 Mac의 iOS Simulator | `http://127.0.0.1:4000` |
| Android Emulator | 일반적으로 `http://10.0.2.2:4000` |
| 실기기 | 개발 PC의 LAN 주소. 서버 listen 주소·방화벽 별도 설정 필요 |

Expo 터미널의 `i` / `a`로 시뮬레이터·에뮬레이터를 엽니다. 외부 API 키는 모바일에 넣지 않습니다.

## 키 없이 확인할 수 있는 범위

| 범위 | 상태 |
| --- | --- |
| 온보딩·관심 항목·탭 이동 | 로컬 UI와 상태 저장 |
| Home·분석 시연 화면 | Mock 또는 준비 중 상태 포함 |
| 백엔드 기본 시세 | Mock Provider |
| OpenDART 기업·공시·재무 | 서버 키가 없으면 오류/이용 불가 상태 |
| AI Analyst 답변 생성 | 서버의 OpenAI 및 분석 입력 데이터 설정 필요 |

로그인 화면과 로컬 플래그는 운영용 사용자 인증 서버를 의미하지 않습니다.

## 실제 데이터 경로

- **Company Twin:** 금융위원회 최근 확정 시세·일봉, OpenDART 기업개황·공시·최근 정기보고서·정규화 재무 8개 항목.
- **독립 로딩:** 시장·기업·공시·재무 영역별 실패 상태를 구분합니다.
- **금액 표시:** 정밀도를 유지하기 위해 정수 문자열을 보존한 뒤 표시 형식으로 변환합니다.
- **AI Analyst:** 백엔드 분석 API의 답변과 같은 분석 세션의 참조 목록을 표시합니다.
- **참조 화면:** 구조화 데이터 참조이며 공시 원문 검색 RAG 통합 완료를 뜻하지 않습니다.
- **남은 분석 기능:** Company Health·미래 확률·관계 해석·경영진 성과·Scenario 계산은 실제 검증 엔진으로 제공되는 기능이 아닙니다.

AI 세션은 현재 프로세스 메모리에 보관되며, 앱 재시작 후 영구 대화 이력 보존을 보장하지 않습니다.

## 구조

```text
app/
  index.tsx        진입 화면
  onboarding.tsx   온보딩
  auth/            로그인·관심 항목 UI
  (tabs)/          Home · Discover · Twin · Portfolio · AI
  company/         기업 상세 화면
  ai/              AI 참조 등 상세 화면
  scenario/        시나리오 화면
  portfolio/       포트폴리오 화면
components/        공통 UI·그래프
lib/               앱 상태·폰트·모션 등 공통 기능
src/               앱 전용 토큰·타입·서비스·Mock 데이터
```

`apps/mobile/src`는 현재 앱이 사용하는 구현입니다. 루트 `src`는 초기 인계 자료이므로 두 디렉터리를 무조건 동기화하거나 덮어쓰지 않습니다.

## 검증

```bash
npx tsc --noEmit
npx expo-doctor
npx expo export --platform web
```

위 명령은 타입·구성·번들 검사입니다. 실제 기기 UI·외부 API 동작 검증은 별도로 수행해야 합니다.

## 배포 전 확인

- Bundle Identifier / Android package의 placeholder 설정 교체
- 템플릿 아이콘 및 스플래시 자산 정리
- 운영 인증·개인정보 처리·API 접근 제어 설계
- 기기별 UI·접근성·성능 검증
- 데이터 이용·표시 권리 및 서비스 고지 확인

현재는 개발 프로젝트이며 앱스토어 출시 완료 상태가 아닙니다.
