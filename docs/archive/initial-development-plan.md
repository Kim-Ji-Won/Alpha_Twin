# 초기 개발 계획 보관본

> 초기 디자인 인계 당시의 계획을 보존한 문서입니다. 아래 체크박스는 당시 상태이며 현재 완료 여부를 나타내지 않습니다. 현재 구현 범위와 실행 방법은 [프로젝트 README](../../README.md)를 참고하세요. 본문의 경로는 당시 저장소 루트 기준입니다.

## P0 — 앱 뼈대
- [ ] Expo 프로젝트 생성 (README 3항 명령어) + src/ 복사
- [ ] Pretendard·JetBrains Mono 폰트 로딩 (expo-font), theme/typography와 연결
- [ ] Expo Router 라우트 생성 — constants/navigation.ts의 ROUTES 전부
- [ ] BottomTabBar + AppHeader + Panel/HeroCard/SectionHeader (specs/components.md)
- [ ] 스플래시(10) → 온보딩(11–13) → 로그인(18) → 관심 선택(19) → 홈 플로우

## P1 — 핵심 5화면
- [ ] Market Brain(01): 국면 히어로 + FoldRow 접기 동작
- [ ] Company Twin(02): HealthAreaList + NetworkGraph(노드 선택/전체화면)
- [ ] Scenario Lab(03/04): AIComposer → 파싱 미리보기 → 결과(ConclusionPanel 최상단)
- [ ] Thesis OS(05/21/22): 작성 → 구조화 미리보기 → 감시 → 변경 기록
- [ ] 차트: ProbabilityChart, ShapFactorChart, SparkLine, DeltaCompare (react-native-svg)

## P2 — 나머지 화면
- [ ] Portfolio X-Ray(06) + 종목 추가/수정/삭제(20)
- [ ] AI Analyst(07) + 근거 상세(23) + 공시 원문 화면
- [ ] Discover(08) + 종목 검색 결과(24 행 컴포넌트 재사용) + 알림 센터(09)
- [ ] Management Track Record(15), 관심 목록(24), 프로필·설정(25)
- [ ] 예외 상태 9종(17)을 공통 컴포넌트로 + 각 화면에 연결
- [ ] 약관/개인정보/투자 유의사항 텍스트 화면 (진입점: 설정)

## P3 — 폴리시
- [ ] CandlestickChart + 이상 거래량 강조
- [ ] NetworkGraph 핀치 줌 + 경로 강조 애니메이션 (gesture-handler + reanimated)
- [ ] 모션: 펄스/dash/draw-in + reduce-motion 대응
- [ ] 앱 아이콘 PNG 변환(assets/app-icon.svg → 1024px) + app.json 등록
- [ ] 접근성 label 전수, 키보드 회피, SE 화면 검증

## 이후 (API 연동 시)
- [ ] services/* 본문을 실제 API로 교체 ([초기 인계 문서](../../HANDOFF.md)의 교체 표)
- [ ] 인증(소셜 로그인), 푸시 알림, 증권사 연동(조회 전용)
- [ ] LLM 응답을 AIAnalysis 구조로 강제하는 서버 스키마
