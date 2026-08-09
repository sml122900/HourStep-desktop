# HourStep Desktop — 세션 기반 웰니스 브레이크 앱 (Windows)

> **작업을 이어갈 때는 `STATUS.md`를 먼저 읽을 것.**
> 현재 Phase·남은 확인 항목·미결 결정은 전부 거기 있다. 작업이 끝나면 `STATUS.md`를 갱신한다.
> 이 파일(CLAUDE.md)은 잘 안 변하는 것(제품 정의·결정·규칙)만 담는다.

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
5. MVP는 **로컬 전용** (tauri-plugin-sql / SQLite). 계정·Supabase·AI API·광고 코드 작성 금지 (이후 Phase).
   D2.6 의 「AI로 루틴 찾기」는 이 금지에 걸리지 않는다 — **API 키도 HTTP 요청도 없고**,
   기본 브라우저를 열어주고 사용자가 복사해 온 텍스트만 파싱한다 (`docs/decisions/0008`)
6. 건강 효용 문구는 연구 인용형("~라는 연구가 있어요")만. 치료·개선 단정 표현 금지
7. git commit·push는 Claude가 직접 수행해도 된다 (2026-08-05 변경). 단 태그·릴리스 배포는 사용자 판단
8. UI 문구는 한국어, 상수 파일(src/constants/strings.ts)로 분리. 사용자가 직접 쓴 카피는 임의 수정 금지 — 우려가 있으면 지적만 하고 원문 유지

## 도메인 모델
실제 정의는 `src/core/types.ts`. 시각은 전부 epoch ms(number) — Date 객체를 쓰지 않는다.

```ts
WorkSession { id, startedAt, endedAt: number | null }         // 진행 중이면 endedAt null
Behavior {
  id, label, emoji,
  message,                                                    // 카드 문구 (비면 label)
  rule: { kind: 'interval', everyMs }                         // 세션 시작 기준 N ms 간격
      | { kind: 'atElapsed', atMs },                          // 세션 경과 특정 시점 1회
  intensity: 'toast' | 'card' | 'fullscreen',                 // MVP는 card만 구현
  enabled: boolean,
  durationSec: number,                                        // 행위 시간. 0=즉시 행동, >0=[완료]가 카운트다운 시작
  isBuiltin: boolean,                                         // 기본 3종 표시 (근거 프로토콜 자리)
  source: 'user' | 'ai',                                      // 문구 출처. 'ai' 는 D2.6 브리지로 가져온 것
  sortOrder: number                                           // 목록 순서, 0부터 연속
}
RoutineItem { emoji, label, minutes, message }                 // 파서 출력 — 아직 행동이 아니다
Occurrence { behaviorId, dueAt, origin: 'regular' | 'snooze' }  // 스케줄러 출력
CompletionLog {
  occurrenceId, behaviorId, action: 'done'|'snoozed'|'skipped', at,
  behaviorLabel?                                              // 기록 시점 이름 스냅샷 (0006)
}
```
- 스케줄러 시그니처: `computeNextOccurrences(session, behaviors, now, horizonMs, snoozes?): Occurrence[]`
  - `horizonMs` 는 now 로부터의 조회 **길이**(ms). 반환은 `[now, now+horizonMs]` 구간, dueAt 오름차순
  - `interval` 첫 발화는 `startedAt + everyMs`. 0분에는 뜨지 않는다
- `occurrenceId(o)` = `` `${behaviorId}@${dueAt}` `` — CompletionLog 가 참조하는 안정적 식별자
- 스누즈(3분 뒤)는 단발 Occurrence 재삽입. 스누즈가 **다음(뒤쪽) 정규 알림**과 5분 이내 겹치면
  병합(정규 것만 유지). **이미 지나간 정규와는 병합하지 않는다** — 그러면 스누즈가 통째로 사라진다
- 카드가 떠 있는 동안 도래한 Occurrence 는 **덮어쓰지 않고 큐로 직렬화**한다
  (`src/core/overlayQueue.ts`, 상한 5건, 세션 종료 시 폐기, 근거: `docs/decisions/0009`).
  큐는 병합하지 않는다 — 겹친 두 행동은 둘 다 해야 할 일이고 기록도 따로 남아야 한다

## 초기 시드 루틴 (내장 3종, `is_builtin`)
- 🧘 스트레칭: 50분 간격, 행위 시간 60초 (완료 시 1분 카운트다운)
- 💧 물마시기: 30분 간격, 행위 시간 0초 (완료 즉시 종료)
- 👀 눈휴식(눈감고 1분): 60분 간격, 행위 시간 60초

D2.5 부터 이건 **최초 시드이자 「기본값 복원」의 기준값**일 뿐이다. 런타임 행동 목록은
DB(`behaviors` 테이블)가 소유하고 사용자가 추가·편집·삭제·정렬한다 (`docs/decisions/0007`).
`is_builtin` 은 향후 근거 기반 프로토콜을 붙일 자리 표시 — 실존 출처 전까지 인용 금지(규칙 6).

## Phase 로드맵
- **D0 (완료)**: 스캐폴딩 + 트레이 상주 + 자동실행 + 오버레이 스파이크
- **D1 (완료)**: 세션 시작/종료 + 스케줄러 순수 함수(vitest) + 오버레이 카드 3액션 + 프리셋 루틴
  + 투명영역 클릭 통과 + single-instance
- **D2 (완료)**: SQLite 영속화 + 통계(오늘/최근 7일 작업시간·실천율) + 설정 화면
  + 세션 미시작 리마인더
- **D2.5 (완료)**: 메인 창 세션 제어·실시간 타이머 + 행동 CRUD(마이그레이션 v2)
  + 라이트/다크/시스템 테마
- **D2.6 (완료)**: AI 검색 브리지 — 프롬프트 생성·복사 + AI 이동 + 붙여넣기 파서
  (마이그레이션 v3). **앱이 AI 결과를 직접 읽지 않는다** (`docs/decisions/0008`)
- **D2.7 (완료)**: 행위 지속 시간(마이그레이션 v4) + 알림음(WebAudio 합성, 2지점)
  + 발화 큐 (`docs/decisions/0009`)
- **D2.8 (완료)**: 디자인 시스템 — 토큰 정의 + 공통 컴포넌트 + 4화면 정렬.
  새 기능 없음. 규격은 `docs/design-system.md`
- **D3**: 풀스크린 앱 감지 억제, 다중 모니터, NSIS 인스톨러, 브랜딩
- 이후(비전): Supabase 동기화 → 모바일과 통합 통계, AI 루틴 생성/코칭

## 코딩 규칙
- TypeScript strict. 스케줄 계산 로직은 src/core/ 아래 순수 모듈로 격리 (React·Tauri import 금지)
- 시간 계산 테스트 필수 케이스: 세션 중간 시작(now가 세션 도중), 스누즈 병합, 자정 넘는 세션, 행동 disabled
- **스누즈 병합에 `Math.abs()` 를 쓰지 말 것.** 병합은 방향성이 있다 — "다음(뒤쪽) 정규"와만 병합한다.
  abs 로 하면 30분 알림을 스누즈한 33분이 방금 지나간 30분 정규와 겹쳤다고 지워져 스누즈가 증발한다
- 통계·설정 반영도 스케줄러와 같은 규칙이다. 순수 함수로 `src/core/` 에 두고 `now`·구간을 인자로 받는다.
  DB 접근은 `src/data/` 어댑터에만 — `src/core/` 는 IO 금지 (eslint 강제)
- **화면 동작을 좌우하는 판단은 컴포넌트 안에 두지 않는다** — `src/core` 의 순수 함수로
  빼고 컴포넌트에는 배선만 남긴다 (`docs/decisions/0011`). 기준은 "틀리면 사용자가
  알아채는가": 빈칸 허용 여부·범위 판정·경계 복구·정렬 규칙은 빼고, useState/useEffect
  배선과 클래스 조립은 남긴다. 컴포넌트 안에 있으면 vitest 가 닿지 않아 **같은 버그가
  두 번 난다** (숫자 입력칸에서 실제로 그랬다)
- **색·간격·글자 크기는 `src/styles/tokens.css` 토큰에서만 온다.** 창별 CSS 에 색 리터럴
  (`#`/`rgb()`)과 임의 px 여백을 쓰지 않는다 — 새 값이 필요하면 토큰부터 정의한다.
  버튼·입력칸·체크박스·카드는 `src/components/` 의 공통 컴포넌트를 쓰고 새로 만들지 않는다.
  규격·예외는 `docs/design-system.md`, 위반은 `src/styles/tokens.test.ts` 가 잡는다
- 오버레이 창은 별도 Tauri window로 관리. 메인 창 닫기 = 트레이로 숨김 (앱 종료 아님)
- 각 Phase 완료 시 docs/daily/에 작업 일지, 기술 결정은 docs/decisions/에 기록

## 검증 환경
Windows 11 데스크톱 (개발 PC = 도그푸딩 기기). 실행: `pnpm tauri dev` / 빌드: `pnpm tauri build`

## 검증 정책
- AI 자동 검증을 최대한 활용한다. 우선순위: ① 프로그램적 상태 검사(창/레지스트리/프로세스/로그)
  ② 앱 디버그 훅(--debug-cmd)을 통한 직접 호출 검증 — 훅이 없으면 만들어서 검증한다
- 사용자 데스크톱 세션에 합성 입력(SendInput 등) 주입은 금지.
  클릭 수준 E2E가 필요하면 Windows Sandbox/VM 격리 환경에서만
- 재부팅·지각 판단(화면에 실제로 보이는가)만 사용자 수동 확인으로 남긴다

### 운영 세부 (위 정책의 해석)
- 화면 캡처(`CopyFromScreen` 등)는 읽기 전용이라 허용. 단 DWM 합성·하드웨어 오버레이 때문에
  캡처와 실제 화면이 다를 수 있으므로 **캡처는 증거이지 최종 판정이 아니다** — 지각 판단은 여전히 사용자 몫
- `PostMessage(WM_CLOSE)` 같은 창 메시지 직접 전송은 합성 입력이 아니므로 허용
- 자동 검증 결과를 문서에 적을 때는 **어떤 방법으로 얻었는지** 함께 남긴다
  (금지된 방법으로 얻은 과거 근거는 재검증 대상으로 표시)
- 창을 찾아 캡처할 때 걸리는 것 세 가지 (D2.8 에서 다 밟았다, 상세는 그날 일지):
  ① **자식 `powershell -File` 프로세스에서는 데스크톱 창이 안 보인다** — `FindWindow`/
  `EnumWindows` 가 0을 준다. 도구 세션 **안에서**(`& script.ps1`) 돌릴 것
  ② **WebView2 가 같은 제목의 160×28 보조 창을 띄운다** — 같은 제목 중 가장 큰 것을 고를 것
  ③ **메인 창은 부팅 때 이미 보인다** — `main-show` 를 기다린다며 부팅 창을 잡는다.
  벽시계 스케줄 대신 **창 상태 전이**(보임→숨김→보임)를 기다릴 것

## 프로젝트 구조
```
index.html / overlay.html / settings.html   창별 Vite 엔트리 (rollupOptions.input)
src/constants/strings.ts                    UI 문구 (한국어) + 내장 행동의 초기 카드 문구
src/styles/                                 세 창이 공유하는 것 (창별 main.tsx 는 base.css 만 읽는다)
  tokens.css                                색·간격·반경·그림자·타이포·모션 — 값의 단일 출처
  components.css                            공통 컴포넌트 스타일 (src/components/ 와 1:1)
  base.css                                  리셋 + 위 둘 @import + 포커스 링
  tokens.test.ts                            토큰 밖 하드코딩 잔존 0건을 강제
src/components/                             전 창 공통 컴포넌트 — 새 버튼/입력칸을 따로 만들지 않는다
  Button / NumberField / Checkbox / Card / Section / EmptyState
src/core/                                   IO 없는 순수 모듈 — React·Tauri import 금지 (eslint로 강제)
  types.ts / scheduler.ts / stats.ts / overlayPosition.ts
  behaviors.ts                              행동 정규화·순서·기본값 복원·레거시 흡수
  overlayQueue.ts                           발화 큐 — 카드가 떠 있는 동안 도래한 것의 적재·인출
  aiQuery.ts / routineParse.ts              AI 브리지 — 프롬프트·이동 주소 / 붙여넣기 파서
  presets.ts                                시드 전용 (런타임 소스 아님)
  settings.ts                               행동 아닌 앱 설정 (리마인더·테마·알림음)
  theme.ts                                  선호 + OS 상태 → 실제 테마          (+ 각 *.test.ts)
src/data/                                   IO 계층 — DB 접근은 전부 여기를 지난다
  db.ts                                     SQLite 어댑터 / range.ts 벽시계 구간·포맷
src/windows/theme.ts                        data-theme 적용 + 설정·OS 변경 추종 (세 창이 각자 1회)
src/windows/sound.ts                        알림음 WebAudio 합성 (오버레이가 재생, 설정은 미리듣기만)
src/windows/{main,overlay,settings}/        창별 React 앱
  main/MainWindow.tsx                       세션 제어 + 실시간 타이머·예정 목록 + 통계
  settings/SettingsWindow.tsx               행동 CRUD + 테마 + 알림음 + 리마인더 + autostart
  settings/RoutineFinder.tsx                AI 브리지 UI (프롬프트→이동→붙여넣기→미리보기→삽입)
  overlay/OverlayWindow.tsx                 세션 런타임(발화 판단·큐·카운트다운·CompletionLog)이 여기 산다
src-tauri/src/lib.rs                        빌더·플러그인·창 이벤트·setup
src-tauri/src/db.rs                         SQLite 스키마·마이그레이션 (읽기/쓰기는 TS 어댑터)
src-tauri/src/session.rs                    세션 상태 + 1초 tick + 가상 시각
src-tauri/src/tray.rs                       트레이 아이콘 + 메뉴
src-tauri/src/overlay.rs                    오버레이 표시/숨김 (Win32 직접 호출)
src-tauri/src/windows.rs                    메인/설정 창 표시·숨김 헬퍼
src-tauri/capabilities/default.json         창 권한 — set-size 등 새 API 쓰면 여기 추가해야 한다
```

### 역할 분담: Rust = 시계, TS = 판단 (근거: `docs/decisions/0004`)
알림 주기 신호는 Rust 가 1초 tick(`app://tick`)으로 준다. 숨겨진 웹뷰에서는 Chromium 이
`setTimeout`/`setInterval` 을 분 단위로 스로틀링해서 JS 타이머로는 50분 뒤 알림을 신뢰할 수 없다.
무엇이 언제 뜰지는 오버레이 웹뷰의 TS 가 `computeNextOccurrences` 로 계산한다.
**세션 상태(startedAt)의 단일 출처는 Rust**(`session.rs`), 기록·설정·행동의 단일 출처는 SQLite.

tick 은 D2.5 부터 **모든 창**으로 간다. 메인 창의 경과시간·다음 알림 카운트다운이
오버레이의 발화 판단과 같은 시각을 봐야 하기 때문 — `Date.now()` 를 쓰면 `--debug-cmd tick:`
의 가상 시각과 갈라져 "표시값 = 실제 발화"를 검증할 수 없다. 숨은 창은 `document.hidden`
으로 렌더만 건너뛴다.

### 저장소
`%APPDATA%\com.hourstep.desktop\hourstep.db` (SQLite, WAL). 스키마·마이그레이션은
`src-tauri/src/db.rs` 가 소유하고, **읽기/쓰기는 `src/data/db.ts` 어댑터만** 한다.
현재 마이그레이션 v4 (`work_sessions` / `completion_logs` / `settings` / `behaviors`).
행동 아닌 설정은 `settings` 테이블에 JSON 한 덩어리 (근거: `docs/decisions/0003`),
행동은 `behaviors` 테이블 (근거: `docs/decisions/0007`).
- 저장된 값을 그대로 믿지 않는다 — `normalizeSettings()` / `normalizeBehaviors()` 로
  범위·타입을 정리한 뒤 쓴다. **설정 창(사용자 입력)과 DB(구버전·손상) 둘 다 신뢰 경계다**
- 시드는 마이그레이션 SQL 이 아니라 어댑터가 심는다(`seedBehaviorsIfEmpty`). 시드 값의
  단일 출처를 `src/core/presets.ts` 한 곳에 두기 위해서 — 「기본값 복원」도 같은 함수를 탄다
- 행동 삭제 후에도 통계가 살아남도록 `completion_logs.behavior_label` 에 기록 시점 이름을
  스냅샷한다. FK `ON DELETE SET NULL` 을 쓰지 않는 이유는 `docs/decisions/0006`
- `behaviors.source` (v3) 는 문구 출처(`'user'|'ai'`)다. `is_builtin` 을 겸용하지 않는 이유는
  `docs/decisions/0008` — 한 열에 두 의미를 태우면 둘 중 하나는 어긋난다
- `behaviors.duration_sec` (v4) 가 행위 시간이다. v3 의 `countdown_ms` 값을 흡수했고
  그 열은 **아무도 읽지 않는 채 남아 있다** (SQLite DROP COLUMN 이 버전을 타서 안 지웠다)
- 앱이 강제 종료되면 `ended_at IS NULL` 세션이 남는다. 기동 시 `closeDanglingSessions(bootedAt)`
  가 **마지막 기록 시각**으로 닫는다. `bootedAt` 인자는 필수 — 없으면 기동 직후 시작한
  살아 있는 세션까지 닫아버린다

## 개발 메모
- 오버레이 창에 `window.show()` / `window.hide()` 직접 호출 금지.
  반드시 `show_overlay_noactivate` / `hide_overlay` 커맨드 경유 (이유: docs/decisions/0001)
- **자동 검증 훅** `--debug-cmd` (개발 빌드 전용, `src-tauri/src/debug_cmd.rs`).
  `--` 를 **세 번** 써야 앱까지 전달된다 (pnpm 이 하나, tauri 가 하나 먹는다):
  ```powershell
  pnpm tauri dev -- -- -- --debug-cmd "wait:4000,dump,start-session,wait:1500,dump,quit"
  ```
  명령: `wait:<ms>` / `start-session` / `end-session` / `tick:<ms>` /
  `overlay-show[:<behaviorId>]` / `overlay-hide` / `done` / `snoozed` / `skipped`
  (= `overlay-action:<action>`) / `settings-open[:ai]` (`:ai` 는 AI 패널까지 펼친다) /
  `ai-copy` ([📋 복사] 와 같은 경로로 클립보드에 쓴다 — 밖에서 `Get-Clipboard` 로 대조) /
  `main-show` / `main-hide` /
  `db-dump` / `behaviors-dump` / `queue-dump` / `main-dump` / `set-interval:<behaviorId>=<분>` /
  `set-duration:<behaviorId>=<초>` / `set-sound:<on|off|0-100>` /
  `behavior-add:<id>=<분>` / `behavior-delete:<id>` / `behavior-move:<id>=<up|down>` /
  `behavior-restore` (**주의: 내장 3종을 시드값으로 되돌린다 — 사용자 편집이 날아간다**) /
  `ai-import[:<분>]` (고정 샘플 답변을 파싱→삽입, D2.6) /
  `set-theme:<light|dark|system>` / `dump` / `quit`,
  맨 끝에 `loop` 를 붙이면 무한 반복
- 알림음은 `[debug] sound start …` / `sound end …` 로 stdout 에 남는다 (실제 소리는 귀로).
  큐는 `queue push … / queue pop … / queue clear …` 와 `queue-dump` 로 본다
- DB 를 만지는 명령(`db-dump` / `behaviors-dump` / `set-interval` / `set-duration` /
  `set-sound` / `behavior-*` / `ai-import` / `set-theme`)은
  **DB 를 어댑터만 읽는다**는 규칙 때문에 Rust 가 직접 처리하지 않고 오버레이 웹뷰에 요청한다.
  결과는 `log_debug` 를 타고 `[debug] …` 로 stdout 에 나온다. 전부 설정 창과 **같은 함수**
  (`saveSettingsAndBroadcast` / `saveBehaviorsAndBroadcast`)를 탄다
- `main-dump` 는 메인 창이 **화면에 그리고 있는 값**(경과시간·다음 알림·남은 시간)을 찍는다.
  `dump` 의 `clock.now`·`elapsedMs` 와 대조하면 타이머 표시값과 실제 발화 시각이 맞는지 보인다
- **`tick:<ms>` 는 가상 시각을 앞으로 감는다.** 50분 간격 알림을 50분 기다리지 않고 검증하는 수단이고,
  스케줄러의 `now` 주입과 완전히 같은 경로다. 단 **정확히 due 시각에 착지해야 카드가 뜬다** —
  `STALE_MS`(2분)보다 밀린 occurrence 는 소진 처리되어 표시되지 않는다 (몰아 띄우기 방지)
- **single-instance 가 켜져 있다.** dev 인스턴스가 이미 떠 있으면 두 번째 실행은 조용히 죽는다.
  스크립트를 돌리기 전에 `Get-Process hourstep-desktop` 로 확인할 것.
  **설치본도 같은 프로세스 이름**이고 같은 DB(`%APPDATA%\com.hourstep.desktop`)를 쓴다 —
  dev 로 검증하면 설치본의 사용자 데이터가 같이 바뀐다. 검증 전에 현재 값을 먼저 덤프해
  기록해 둘 것 (2026-08-09 에 조사하다 `behavior-restore` 로 사용자 편집을 날린 적이 있다)
- 오버레이 표시 여부는 `overlay::is_visible()` 로 확인. `WebviewWindow::is_visible()` 은
  raw Win32 로 show/hide 하는 탓에 항상 false 를 반환한다 (docs/decisions/0001)
- 오버레이 창은 표시할 때마다 **카드 실크기로 리사이즈**된다 (`OverlayWindow.fitWindow`,
  근거: `docs/decisions/0005`). 투명 영역이 남으면 그만큼 하위 창의 클릭이 막히기 때문.
  그래서 카드 CSS 에 바깥 여백·드롭섀도를 주면 안 된다 — 창 밖이라 잘리고, 여백은 죽은 영역이 된다
- `fitWindow` 는 **표시가 먼저, 측정이 나중**이다. 숨겨진 WebView2 는 레이아웃을 안 돌려서
  `getBoundingClientRect()` 가 전부 0으로 나온다
- **알림음은 파일이 아니라 WebAudio 합성이다** (`src/windows/sound.ts`). 재생 주체는 **오버레이 창** —
  메인 창은 트레이로 숨어 있을 수 있다. 웹뷰가 사용자 조작 전 오디오를 재우지 않도록
  `tauri.conf.json` 의 세 창 모두에 `additionalBrowserArgs` 로
  `--autoplay-policy=no-user-gesture-required` 를 준다. **세 창이 같은 문자열이어야 한다** —
  WebView2 환경은 창끼리 공유되므로 창마다 다른 인자를 주면 창 생성이 실패할 수 있다.
  기본값(`--disable-features=msWebOOUI,…`)을 덮어쓰는 자리라 그 인자도 함께 적어야 한다
- **색은 전부 `src/styles/base.css` 토큰으로만 정의한다.** 창별 CSS 는 토큰만 참조 — 그래야
  라이트/다크가 세 창 + 오버레이 카드에 한꺼번에 먹는다. `:root` 기본값이 다크인 건
  속성이 붙기 전 한 프레임의 흰 번쩍임을 막기 위한 것
- **설정 창은 "다시 보일 때" 다시 읽는다.** 창은 앱 기동 때 만들어져 한 번 읽고 숨어 있다가
  나중에 보이므로, 그 사이 바뀐 값(다른 창의 복원, `--debug-cmd`)을 놓친다.
  반대로 보이는 동안 오는 방송은 무시한다 — 대부분 자기가 낸 것이고, 그때 다시 읽으면
  타이핑 중인 값을 덮어쓴다. 글자 입력은 blur(또는 창이 숨을 때) 저장, 나머지는 즉시 저장
- pnpm 11+ 설정은 package.json 이 아니라 `pnpm-workspace.yaml` 에 둔다
- 빌드 전제: Rust(stable-msvc) + **Windows SDK 컴포넌트**. SDK 없으면 `link.exe not found`
- **dev 서버 포트는 1420 이 아니라 5183** (HMR 5184). Windows(Hyper-V/WinNAT)가 재부팅마다 임의
  TCP 구간을 예약하는데 이 PC 에서 1336–1435 가 잡혀 `listen EACCES` 로 죽었다.
  또 걸리면 `netsh interface ipv4 show excludedportrange protocol=tcp` 로 빈 번호를 찾아
  `vite.config.ts` + `src-tauri/tauri.conf.json` 의 `devUrl` 을 **같이** 고친다
  (상세: `docs/troubleshooting/vite-port-eacces.md`)

## 진행 상황
→ **`STATUS.md`** 참고. 진행 상황·남은 확인 항목·미결 결정은 이 파일이 아니라 STATUS.md에 쓴다.
