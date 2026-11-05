# HANDOFF.md — ALPHA TWIN 화면별 인계 문서

> 초기 디자인 인계 기록입니다. 아래 구현 지시·교체 위치·미완료 목록은 당시 계획이며 현재 상태와 다를 수 있습니다. 현재 구현과 실행 방법은 [프로젝트 README](README.md), [모바일 문서](apps/mobile/README.md), [백엔드 문서](apps/api/README.md)를 기준으로 확인하세요.

디자인 원본: `design/Alpha Twin.dc.html` (브라우저로 열기). 프레임 번호 = 캔버스 라벨.

## 상태 색상의 의미
- `accent #22d3ee` — AI/분석/선택/브랜드. 등락 색 아님
- `pos #34d399` — 긍정·상승·달성·논제 강화
- `neg #f87171` — 부정·하락·철회·논제 충돌 영향
- `warn #fbbf24` — 주의·지연·괴리·충돌 알림·확인 필요
- 등락은 색+기호(▲▼)+부호 병행. 설정에서 국내형(빨강/파랑)으로 전환 가능해야 함

## 차트의 의미
- **확률 팬차트**: 단일 목표가 금지. 현재 시점 기준선에서 68%(진한 시안)/95%(옅은 블루) 콘이 벌어짐. 중앙값은 점선. 이벤트 마커(amber)는 실적발표 등. disclaimer 필수
- **SHAP 바**: "왜 이 확률인가"의 근거. 중앙선 좌=하락 기여, 우=상승 기여
- **캔들**: 상승=채움, 하락=외곽선(색맹 대응 패턴)
- **논제 스파크라인**: 건강도 추이 + 변화 이벤트 도트
- **네트워크**: 엣지 굵기=의존도, 점선 흐름 애니메이션=선택된 영향 경로

## 화면별 목적 · 컴포넌트 · 이동
| # | 화면 | 목적 | 주요 컴포넌트 | 이동 |
|---|---|---|---|---|
| 10 | 스플래시 | 트윈 동기화 로딩 | 로고+궤도, LoadingBar | → 온보딩/홈 |
| 11–13 | 온보딩 | 3가지 핵심 가치 | 대형 SVG 비주얼, 도트, 얇은 CTA(250px, r8) | → 로그인 |
| 18 | 로그인 | 소셜/이메일 인증 | SocialButton×3, TextField | → 관심 선택 |
| 19 | 관심 선택 | 산업→종목 개인화 | 진행바, SelectableChip, 종목 행 | → (종목 추가) → 홈 |
| 20 | 종목 추가 | 증권사 연결(조회 전용)/수동 입력 + 매수 이유→논제 유도 | 선택 타일, TextField, alert Panel | → 논제 작성 21 |
| 01 | Market Brain | 오늘 시장의 핵심만 | 국면 HeroCard(유지확률), 지표 3, 포트폴리오 영향 알림, EventTimeline, FoldRow(수급/산업/이상) | → CompanyTwin, 알림 09, Scenario 03 |
| 02 | Company Twin | 기업 트윈 종합 | 종목 헤더, ScoreIndicator(hero)+신뢰도, HealthAreaList, FoldRow(확률/이벤트), NetworkGraph | → Scenario, Thesis 05, Management 15 |
| 03 | Scenario 입력 | 자연어→구조화 | AIComposer, 파싱 미리보기, 템플릿 칩 | → 결과 04 |
| 04 | Scenario 결과 | 전후 비교 | **ConclusionPanel(최상단)**, 전달 경로, DeltaCompare, 영향 기업 | → CompanyTwin |
| 05 | Thesis OS | 논제 감시 | 건강도 hero+SparkLine+근거 칩, 원문 인용, CheckItem×4, 지표, KillCriteria | → 변경 기록 22, 작성 21 |
| 21 | 논제 작성 | 자연어→가설 구조화 | AIComposer, 구조화 미리보기 | → 05 |
| 22 | 변경 기록 | 버전·건강도 이력 | SparkLine, VersionTimeline | ← 05 |
| 06 | Portfolio X-Ray | 숨은 공통 위험 | headline HeroCard, RiskBar×4, NetworkGraph(중첩 지도), 통계 3, AllocationBar, 제안 Panel | → Scenario, 위험 상세 |
| 07 | AI Analyst | 근거 기반 Q&A | 말풍선(결론/근거/반대/데이터/근거 칩 행), followUp 칩, AIComposer | → 근거 상세 23 |
| 23 | 근거 상세 | 출처·모델 투명성 | 기준일/신뢰도/미확인 kv, SourceQuote×3, 모델 기여도 바 | → 공시 원문(외부) |
| 08 | Discover | 탐색+개인화 추천 | SearchField, 자연어 칩, 이상 신호(EventTimeline+**추천 이유**), 산업 트윈, Narrative Gap | → CompanyTwin |
| 09 | 알림 센터 | 논제 충돌 우선 | Panel(alert)=충돌: "발언 vs 데이터" 대비 + 논제 영향, 강화/이벤트/국면 | → CompanyTwin/Thesis |
| 24 | 관심 목록 | 트윈 요약 행 | 필터 칩, 종목 행(상태+논제+미니바), 괴리 하이라이트 | → CompanyTwin |
| 15 | Management | 발언–실적 일치 기록 | 이행률 hero+분포 바, 달성/지연/철회 행, 표현 변화, 가이던스 일관성 | ← CompanyTwin |
| 25 | 프로필·설정 | 계정·알림·표시 | 아바타, 통계 3, Toggle(충돌=우선, 속보=기본 OFF), 등락 색상 | → 약관/개인정보/유의사항 |
| 17 | 예외 상태 9종 | 전 화면 공통 | Loading/Error/Empty/Stale/Estimated | — |
| 26 | 흐름 맵 | 내비 구조 원본 | — | — |

## 중요 인터랙션
1. FoldRow: 접힌 상태에도 핵심 수치 노출. Market Brain·Company Twin의 세부는 기본 접힘
2. NetworkGraph: 노드 탭→경로 강조+하단 설명 갱신, ⤢→전체 화면 모달, 핀치 줌
3. 알림 탭→해당 트윈/논제 딥링크. 충돌 알림엔 논제 영향(−4) 배지
4. AIComposer: 전송 후 "AI 분석 중" LoadingState(단계 표시) → 구조화 결과
5. 모션: 펄스 2.2s, dash 1.3s, draw-in 1.4s. `prefers-reduced-motion`/설정으로 비활성

## Mock → 실제 API 교체 위치
`src/services/*.ts`의 메서드 본문만 교체 (시그니처 유지):
- marketService → 시장 데이터 API · stockService → 주가/재무/DART · thesisService.structureFromText → LLM · scenarioService.parse/run → LLM+ML · aiService.ask → AI Analyst API (반환은 반드시 AIAnalysis 구조) · notificationService → 푸시/알림 API

## 아직 정적인 것 (디자인상 표현만 존재)
- 네트워크 그래프 물리 시뮬레이션(디자인은 고정 좌표 SVG)
- 차트 구간 선택→AI 질문 진입
- 증권사 실제 연동, 인증, 푸시
- Narrative Gap 상세 화면(Discover에 요약만 존재)
- 종목 검색 결과 화면(디자인은 Discover 검색바까지 — 24번 행 컴포넌트 재사용)
- 약관/개인정보/유의사항 본문(설정에 진입점만 존재 — 텍스트 화면으로 구현)

## 구현 시 주의사항
- 단정 카피 금지("무조건", "매수하세요"). 모든 확률에 disclaimer
- LLM이 수치 생성 금지 — 항상 분석 결과 인용
- 모든 분석 화면에 asOf 표시. 오래됨/부족/실패는 프레임 17 패턴
- 디자인 임의 단순화·재설계 금지. 색상값은 theme 토큰만 사용
- Safe area, 최소 터치 44pt, 접근성 label(점수는 "기업 상태 74점, 전일 대비 3 하락" 식으로 읽히게)
