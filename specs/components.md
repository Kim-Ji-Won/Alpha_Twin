# 공통 컴포넌트 명세 (Props 계약)

구현 시 이 시그니처를 그대로 사용하라. 시각 스펙은 `design/Alpha Twin.dc.html`의 해당 CSS 클래스를 참조 (괄호 표기).

## 레이아웃 / 셸
- **AppHeader** (`.hd`) — `{ subtitle?: string; title: string; live?: boolean; right?: ReactNode; onBack?: () => void }` — subtitle은 dim 12.5px, title 22px/800. live=true면 accent 펄스 점.
- **BottomTabBar** (`.nav .nb .navon`) — `{ active: 'home'|'discover'|'twin'|'portfolio'|'ai' }` — 활성 탭: accent 색 + 상단 2px 인디케이터. 높이 62 + safe area.
- **SectionHeader** (`.ohd`, `.pt`) — `{ label: string; meta?: string }` — 11.5px uppercase +1.2 dim. 카드 안(pt)/밖(ohd) 두 변형.
- **FoldRow** (`.fold .chev`) — `{ title: string; summary: ReactNode; expanded: boolean; onToggle: () => void; children }` — 접힌 상태에 핵심 수치 요약 필수.
- **Panel** (`.panel`, `.alert`, `.warnpanel`) — `{ variant?: 'default'|'alert'|'danger'; children }` — alert=amber 보더, danger=red 틴트.
- **HeroCard** (`.hero .tag`) — `{ tag: string; children }` — accent 그라디언트 틴트 + 22px radius. 화면당 1개만.

## 데이터 표시
- **StatusBadge** (`.badge`, `.chip`) — `{ label: string; tone: 'accent'|'pos'|'neg'|'warn'|'neutral'; size?: 'sm'|'md' }`
- **MetricRow** (`.kv`) — `{ label: string; value: string; direction?: Direction }` — 값은 mono. 방향 있으면 색+기호.
- **ScoreIndicator** (`.heroScore`, `.hbar`) — `{ score: number; trend?: Trend; size: 'hero'|'row' }` — hero=44px mono + 전일 대비, row=미니 바.
- **FacetBar** (`.facet .ft`) — `{ label: string; pct: number; tone: string; valueText: string }` — 위험 노출/가이던스 일관성 바.
- **EvidenceChip / SourceChip** (`.chips .chip`) — `{ kind: 'evidence'|'filing'|'date'|'counter'|'confidence'; text: string; onPress? }` — AI 답변 하단 근거 행.
- **SourceQuote** (`.qsrc`) — `{ source: EvidenceSource; accentColor?: string }` — 좌측 2.5px 컬러 보더 + 이탤릭 발췌 + 출처/날짜 mono.
- **CheckItem** (`.check .ckic`) — `{ status: 'confirmed'|'watch'|'unverified'; title: string; note?: string }` — ✓(pos)/!(warn)/?(dim) 원형 아이콘.
- **EventTimeline** (`.evt .stub`) — `{ events: CompanyEvent[]; onPress(e) }` — 좌측 컬러 스텁 + 배지 + 영향 경로 + 출처.
- **VersionTimeline** (`.vtl .vte`) — `{ changes: ThesisChange[] }` — 세로선 + 도트(변화 방향 색).
- **ConclusionPanel** — HeroCard 변형. `{ tag: 'AI 핵심 결론'; text: string }` — Scenario 결과 최상단 필수.

## 버튼 / 입력
- **PrimaryButton** (`.btnp`) — `{ label; onPress; disabled? }` — accent→accent2 그라디언트, 텍스트 #03121b, radius 15.
- **SecondaryButton** (`.btng`) — 패널 배경 + 보더.
- **SelectableChip** (`.tk .tk.on`) — `{ label; selected; onPress }` — 선택 시 accent 보더+틴트+✓.
- **SearchField** (`.srch`) / **TextField** (`.field`) / **AIComposer** (`.input .send`) — AIComposer는 "AI가 변환 중" 상태 라벨 슬롯 포함.
- **Toggle** (`.tgl`) — `{ value; onChange }` — on: accent 트랙+노브.

## 차트 (모두 Mock Data props로 — 내부 데이터 금지)
- **CandlestickChart** — `{ candles: {o,h,l,c,v,date}[]; anomalies?: number[] }` — 상승=채움 emerald, 하락=외곽선 red, 이상 거래량=accent 볼륨 바.
- **ProbabilityChart** — `{ dist: ProbabilityDistribution; history: number[] }` — 현재 기준선, 68/95% 콘, 중앙값 점선, 이벤트 마커(amber 원+라벨), disclaimer 텍스트 필수 렌더.
- **ShapFactorChart** — `{ factors: { label; value }[] }` — 중앙선 기준 좌(neg)/우(pos) 바 + mono 수치.
- **HealthAreaList** — `{ areas: HealthArea[] }` — 점수 + 변화 + reason(필수).
- **SparkLine** — `{ points: {date,score}[]; markers? }` — 논제 건강도 추이.
- **DeltaCompare** — `{ deltas: ScenarioDelta[] }` — `74 → 63` 형식, 방향 색+화살표.
- **RiskBar** — FacetBar 재사용.
- **NetworkGraph** — `{ nodes; edges; selectedId?; onSelectNode(id); fullscreenEnabled }` — 핀치 줌/전체화면(⤢)/노드 선택 시 경로 강조 + 하단 설명("선택됨: 엔비디아 — 의존도 28% · 경로: …"). react-native-svg + gesture-handler 권장.
- **AllocationBar** — `{ items: {label,weight}[] }` — 스택 바 + 레전드.

## 상태
- **LoadingState** — `{ stage?: string; steps?: {label,status}[] }` — 트윈 동기화 다이아몬드 펄스 + 단계 리스트 (프레임 17).
- **ErrorState** — `{ message; lastGood?: string; onRetry }` — 실패 시 마지막 성공 결과 유지 안내.
- **EmptyState** — `{ icon; title; message; actionLabel; onAction }` — 빈 포트폴리오/검색 없음.
- **StaleDataBanner** — `{ asOf: string; onRefresh }` — 15일 경과 등.
- **EstimatedDataTag** — `{ note: string }` — "공개 자료 기반 추정" 표시.

공통 규칙: 모든 분석 컴포넌트는 `asOf`(데이터 기준일)를 표시할 자리가 있어야 한다. 숫자는 전부 mono + tabular. 상태는 색+기호+텍스트 삼중 표기.
