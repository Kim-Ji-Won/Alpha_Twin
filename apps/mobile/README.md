# ALPHA TWIN — 모바일 앱 (apps/mobile)

Claude Design 인계 패키지(리포 루트)를 기반으로 생성한 실행 가능한 Expo 앱입니다.
디자인 원본·명세는 루트의 `design/`, `specs/`, `HANDOFF.md`를 참조하세요.

## 실행

```bash
cd apps/mobile
npm install
npx expo start
```

iOS 시뮬레이터: `i` · Android 에뮬레이터: `a` · 실기기: Expo Go로 QR 스캔

## 기술 스택

- Expo SDK 57 · React Native 0.86 · TypeScript · Expo Router (tabs 템플릿)
- react-native-svg (브랜드/아트/그라디언트), @react-native-async-storage/async-storage (P0 로컬 플래그)
- 폰트: Pretendard (npm `pretendard`, OFL-1.1) + JetBrains Mono (`@expo-google-fonts/jetbrains-mono`, OFL-1.1)

## ⚠️ 배포 전 변경 필요 (임시값)

| 항목 | 현재 임시값 | 위치 |
|---|---|---|
| iOS Bundle Identifier | `com.alphatwin.placeholder` | `app.json` → `expo.ios.bundleIdentifier` |
| Android Package Name | `com.alphatwin.placeholder` | `app.json` → `expo.android.package` |
| 앱 아이콘 | tabs 템플릿 기본 아이콘 | `assets/images/` — 루트 `assets/app-icon.svg`를 1024px PNG로 변환해 교체 (TODO P3) |

## 구조

```
app/                 Expo Router 라우트
├── index.tsx        스플래시 (프레임 10) → 상태에 따라 분기
├── onboarding.tsx   온보딩 3페이지 (프레임 11–13)
├── auth/login.tsx   로그인 (프레임 18)
├── auth/interests.tsx 관심 산업·종목 (프레임 19)
└── (tabs)/          하단 탭 5개 — home/discover/twin/portfolio/ai
components/          P0 공통 컴포넌트 (AppScreen, AppHeader, BottomTabBar, 버튼, Panel …)
lib/                 fonts(폰트 레지스트리)/typography(토큰→TextStyle)/appState(로컬 플래그)
src/                 루트 인계 패키지에서 복사한 실소스 (theme/types/mocks/services/constants)
```

- `src/`는 루트 `../../src`의 복사본입니다. 루트가 원본(source of truth)이며, 수정 시 양쪽 동기화가 필요합니다.
- 화면은 `src/services`만 호출합니다 (Mock → 실제 API 교체 지점, HANDOFF.md 참조).
- 온보딩/로그인 상태는 AsyncStorage 키 `@alpha-twin/app-flags-v1`에 저장됩니다. 초기화하려면 앱 삭제 후 재설치하거나 해당 키를 지우세요.
