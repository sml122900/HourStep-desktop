# HourStep Desktop — 세션 기반 웰니스 브레이크 앱 (Windows)

## 제품 한 줄
트레이 상주 앱. 사용자가 "작업 시작"을 누르면 루틴(스트레칭/물마시기/눈휴식)에 따라
화면 중앙 상단에 무시하기 어려운 오버레이 카드를 띄워 건강 행동을 실천시킨다.
세션 종료 시 오늘 작업시간·휴식 실천 통계를 보여준다.

## 배경 (왜 만드는가)
- 앉아서 일하는 사람은 매시간 스트레칭·수분·눈휴식이 필요하다는 걸 알지만 실행 트리거가 없다
- 개발자 본인이 1번 타겟 유저 — 모바일 알림보다 "지금 보고 있는 화면"에 뜨는 게 효과적
- 벤치마크: Stretchly(오픈소스 강제휴식 앱). 차별점은 세션 모델 + 한국어 + 다행동 루틴 + (향후) AI 맞춤

## 핵심 결정 — 변경하려면 반드시 사용자와 논의
1. **Tauri v2** + React + TypeScript + Vite + pnpm. Rust 코드는 최소화, 가능하면 공식 플러그인으로 해결
2. **세션 모델**: 알림은 활성 WorkSession 중에만 발생. 고정 근무시간 개념 없음
3. 오버레이 기본 강도는 **중앙 상단 카드** (프레임리스, always-on-top). 풀스크린 딤은 행동별 opt-in (P2)
4. **스케줄러는 IO 없는 순수 함수 + vitest**. 모바일(Expo)과 공유 전제 — now를 인자로 주입, 플랫폼 API 참조 금지, Date.now() 직접 호출 금지
5. MVP는 **로컬 전용** (tauri-plugin-sql / SQLite). 계정·Supabase·AI·광고 코드 작성 금지 (이후 Phase)
6. 건강 효용 문구는 연구 인용형("~라는 연구가 있어요")만. 치료·개선 단정 표현 금지
7. git commit·push는 Claude가 직접 수행해도 된다 (2026-08-05 변경). 단 태그·릴리스 배포는 사용자 판단
8. UI 문구는 한국어, 상수 파일(src/constants/strings.ts)로 분리. 사용자가 직접 쓴 카피는 임의 수정 금지 — 우려가 있으면 지적만 하고 원문 유지

## 도메인 모델
```ts
WorkSession { id, startedAt, endedAt: string | null }        // 진행 중이면 endedAt null
Behavior {
  id, name, icon,
  rule: { type: 'interval', minutes: number }                // 세션 시작 기준 N분 간격
      | { type: 'atElapsed', minutesList: number[] },        // 세션 경과 특정 시점들
  intensity: 'toast' | 'card' | 'fullscreen',                // MVP는 card만 구현
  enabled: boolean
}
Occurrence { behaviorId, scheduledAt }                        // 스케줄러 출력
CompletionLog { behaviorId, scheduledAt, action: 'done' | 'snoozed' | 'skipped', at }
```
- 스케줄러 시그니처: `computeNextOccurrences(session, behaviors, now, horizon): Occurrence[]`
- 스누즈(3분 뒤)는 단발 Occurrence 재삽입. 스누즈가 다음 정규 알림과 5분 이내 겹치면 병합(정규 것만 유지)

## 프리셋 루틴 (MVP 내장 1종)
- 🧘 스트레칭: 50분 간격, 완료 시 1분 카운트다운 제안
- 💧 물마시기: 30분 간격
- 👀 눈휴식(눈감고 1분): 60분 간격

## Phase 로드맵
- **D0 (현재)**: 스캐폴딩 + 트레이 상주 + 자동실행 + 오버레이 스파이크 ← 지금 여기
- **D1**: 세션 시작/종료 + 스케줄러 순수 함수(vitest) + 오버레이 카드 3액션 + 프리셋 루틴
- **D2**: SQLite 통계(오늘/주간 작업시간·실천율) + 설정 화면 + 세션 미시작 리마인더
- **D3**: 풀스크린 앱 감지 억제, 다중 모니터, NSIS 인스톨러, 브랜딩
- 이후(비전): Supabase 동기화 → 모바일과 통합 통계, AI 루틴 생성/코칭

## 코딩 규칙
- TypeScript strict. 스케줄 계산 로직은 src/core/ 아래 순수 모듈로 격리 (React·Tauri import 금지)
- 시간 계산 테스트 필수 케이스: 세션 중간 시작(now가 세션 도중), 스누즈 병합, 자정 넘는 세션, 행동 disabled
- 오버레이 창은 별도 Tauri window로 관리. 메인 창 닫기 = 트레이로 숨김 (앱 종료 아님)
- 각 Phase 완료 시 docs/daily/에 작업 일지, 기술 결정은 docs/decisions/에 기록

## 검증 환경
Windows 11 데스크톱 (개발 PC = 도그푸딩 기기). 실행: `pnpm tauri dev` / 빌드: `pnpm tauri build`

## 검증 정책
- AI 자동 검증을 최대한 활용한다. 우선순위:
  1. **프로그램적 상태 검사** — 창 핸들·스타일·좌표(`EnumWindows`/`GetWindowLongW`), 레지스트리, 프로세스, stdout 로그
  2. **앱 디버그 훅**(`--debug-cmd`)을 통한 직접 호출 검증 — **훅이 없으면 만들어서 검증한다**
- **사용자 데스크톱 세션에 합성 입력(`SendInput` 등) 주입 금지.**
  클릭 수준 E2E가 필요하면 Windows Sandbox / VM 격리 환경에서만 한다
- 화면 캡처(`CopyFromScreen` 등)는 읽기 전용이라 허용. 단 DWM 합성·하드웨어 오버레이 때문에
  캡처와 실제 화면이 다를 수 있으므로 **캡처는 증거이지 최종 판정이 아니다**
- 다음 둘만 사용자 수동 확인으로 남긴다:
  - **재부팅**이 필요한 것
  - **지각 판단** — 실제로 눈에 보이는가, 애니메이션이 자연스러운가, 방해되지 않는가
- 자동 검증 결과를 문서에 적을 때는 **어떤 방법으로 얻었는지** 함께 남긴다
  (금지된 방법으로 얻은 과거 근거는 재검증 대상으로 표시)

## 프로젝트 구조
```
index.html / overlay.html / settings.html   창별 Vite 엔트리 (rollupOptions.input)
src/constants/strings.ts                    UI 문구 (한국어)
src/core/                                   IO 없는 순수 모듈 — React·Tauri import 금지 (eslint로 강제)
src/windows/{main,overlay,settings}/        창별 React 앱
src-tauri/src/lib.rs                        빌더·플러그인·창 이벤트·setup
src-tauri/src/tray.rs                       트레이 아이콘 + 메뉴
src-tauri/src/overlay.rs                    오버레이 표시/숨김 (Win32 직접 호출)
src-tauri/src/windows.rs                    메인/설정 창 표시·숨김 헬퍼
```

## 개발 메모
- 오버레이 창에 `window.show()` / `window.hide()` 직접 호출 금지.
  반드시 `show_overlay_noactivate` / `hide_overlay` 커맨드 경유 (이유: docs/decisions/0001)
- 개발 빌드 스모크: `$env:HOURSTEP_SPIKE_AUTO_OVERLAY="1"; pnpm tauri dev`
  → 사람 클릭 없이 8초 뒤 첫 표시, 이후 8초 표시 / 12초 대기 반복
  → **`--debug-cmd` 디버그 훅으로 대체 예정** (검증 정책 참고). 훅이 생기면 이 환경변수는 제거
- pnpm 11+ 설정은 package.json 이 아니라 `pnpm-workspace.yaml` 에 둔다
- 빌드 전제: Rust(stable-msvc) + **Windows SDK 컴포넌트**. SDK 없으면 `link.exe not found`

## 진행 상황
- **D0 완료 (2026-08-05)** — 스캐폴딩 / 트레이 상주 / 부팅 자동실행 / 오버레이 스파이크 / NSIS·MSI 빌드 확인.
  실측: 오버레이가 주 모니터 중앙 상단(640,0)에 TOPMOST+TOOLWINDOW+NOACTIVATE로 뜨고 포커스를 뺏지 않음. 메모리 약 32MB.
  일지 `docs/daily/2026-08-05-phase-d0.md` / 수동 검증 절차 `docs/phase-d0-verification.md` (사용자 확인 대기)
- D1 착수 전: 위 검증 문서 A~F 통과 확인 필요 (특히 C 전체화면 / D 듀얼 모니터)
