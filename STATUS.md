# STATUS — HourStep Desktop 진행 상황

> 이 파일이 **현재 상태의 단일 출처(single source of truth)** 다.
> 작업을 이어갈 때 가장 먼저 읽고, 작업이 끝나면 여기부터 갱신한다.
> 배경·규칙은 `CLAUDE.md`, 상세 기록은 `docs/daily/`·`docs/decisions/`.

**마지막 갱신: 2026-08-12** · **현재 Phase: D2.10 완료(자동 검증까지) → 다음 D3**
**설치본: 0.4.2** (`%LOCALAPPDATA%\HourStep`, NSIS per-user, `/S` 무인 설치) —
D2.10 후속(완전 종료 버튼)까지 들어간 빌드다. `package.json`/`Cargo.toml`/
`tauri.conf.json` 세 곳 모두 0.4.1→0.4.2(패치, 0.4.1 때와 같은 기준). 설치 전
실행 중이던 0.4.1(PID 48792)을 종료 → `pnpm build` → `pnpm tauri build`(NSIS/MSI) →
`HourStep_0.4.2_x64-setup.exe /S`. 설치 후 직접 실행해 캡처로 새 버튼·문구 배치를
확인했고, DB(`work_sessions=13 completion_logs=99 behaviors=3`)는 ASCII 경로로 뜬
사본을 sqlite3 로 조회해 실행 전후 대조— 이번 변경은 스키마·세션 로직을 건드리지
않아 그대로였다(raw sqlite 조회이며 db-dump 훅은 release 빌드엔 없다 — 개발 빌드
전용).

**설치본: 0.4.1** (`%LOCALAPPDATA%\HourStep`, NSIS per-user, `/S` 무인 설치) —
2026-08-12 01:50 설치 완료. D2.10(동작 목록·선택 + 카운트다운 중 동작 안내,
마이그레이션 v6)까지 들어간 빌드다. 설치 직후 실행해 마이그레이션이 실제로 도는지
확인했다 — DB 를 읽기 전용으로 대조(ASCII 경로 사본, 아래 참고)해 `action_prefs` 8행이
전부 켬으로 새로 생겼고 `sessions=12 logs=66` 는 그대로임을 확인했다(그냥 실행만
했을 뿐 세션을 만들지 않았으니 당연하지만, 실측으로 남긴다).

D2.10 검증(설치 전, dev 로 진행 — 설치본 0.4.0 을 잠시 종료했다)에서 시행착오가
하나 있었다: `wait` 없이 비동기 디버그 명령을 연달아 보내면 도착 순서가 뒤바뀔 수
있다는 걸 처음 확인했고, 그 여파로 세션 1건·기록 1건이 실 데이터에 남았었다
(`sessions` 12→13, `logs` 66→67, 작업시간 몇 초짜리). **직접 확인하고 지웠다** —
DB 를 ASCII 경로로 복사해(사용자명에 한글이 있어 `sqlite3.exe` 가 원본 경로를
못 열었다) `work_sessions`/`completion_logs` 에서 정확히 그 행(`s-1786465875368`,
시작~종료 2977ms, log id=70)만 골라 지운 뒤 원본에 덮어썼고, 앱 자체의 `db-dump`
로 `sessions=12 logs=66` 복귀를 재확인했다. 상세는 `docs/daily/2026-08-12-phase-d2.10.md`.

⚠️ dev 와 설치본이 **같은 DB**(`%APPDATA%\com.hourstep.desktop\hourstep.db`)를 쓴다 —
`--debug-cmd` 검증은 사용자 데이터를 바꾼다. 실제로 설정을 날린 적이 있다:
`docs/troubleshooting/dev-and-installed-share-db.md`. 2026-08-11 검증(D2.9) 은 실 DB 에
`sessions=11 logs=54 behaviors=3` 그대로임을 전후 대조로 확인했고 세션·기록은 만들지
않았다 — 상세는 `docs/daily/2026-08-11-phase-d2.9.md`

---

## 완료

- **D0 (2026-08-05~07)** — 스캐폴딩 / 트레이 상주 / 부팅 자동실행 / 오버레이 스파이크 / 번들.
  검증 자동화(`--debug-cmd`) + 수동 검증 4건 전부 통과.
  일지 `docs/daily/2026-08-05-phase-d0.md`, `2026-08-05-d0-verification.md`,
  `2026-08-07-d0-verification-manual.md`
- **D1 (2026-08-07)** — 세션 + 스케줄러 코어 루프. 일지 `docs/daily/2026-08-07-phase-d1.md`
  - 도메인 타입 / `computeNextOccurrences` + vitest / 프리셋 루틴 3종 / 오버레이 실배선
  - **「알려진 한계 1」 해소** — 창을 카드 실크기로 축소, 카드 밖 클릭이 하위 창에 도달
  - **「알려진 한계 3」 해소** — single-instance
- **D2 (2026-08-07)** — 영속화 + 통계 + 설정. 일지 `docs/daily/2026-08-07-phase-d2.md`
  - SQLite(`tauri-plugin-sql`) 마이그레이션 v1. write→재시작→read 왕복 확인
  - 강제 종료로 남은 미종료 세션을 기동 시 마지막 기록 시각으로 복구
  - 통계 순수 함수 + vitest. 세션 종료 요약 카드 / 메인 창 오늘·최근 7일
  - 설정 창: 행동별 on/off·간격, 미시작 리마인더, autostart. **실행 중 세션에 즉시 반영**
  - 세션 미시작 리마인더 (유휴 구간당 1회)
- **D2.5 (2026-08-08)** — 메인 화면 + 커스텀 행동 + 테마.
  일지 `docs/daily/2026-08-08-phase-d2.5.md`
  - 메인 창에서 세션 시작/종료 (트레이와 같은 커맨드 → 라벨 양방향 동기화, 폴링 없음)
  - 실시간 타이머: 경과시간 / 다음 알림 카운트다운 / 예정 5건. `app://tick` 을 모든 창으로
  - **행동 CRUD** — `behaviors` 테이블 신설(마이그레이션 v2), 추가·편집·삭제·순서·기본값 복원.
    `presets.ts` 는 시드 전용으로 축소, `applySettings()` 삭제
  - 삭제된 행동의 과거 기록 보존 — `completion_logs.behavior_label` 이름 스냅샷
  - 라이트/다크/시스템 테마. CSS 변수화 후 세 창 + 오버레이 카드 전부 적용
  - vitest **75개** (scheduler 16 / stats 15 / behaviors 27 / settings 8 / theme 4 / overlayPosition 5)
- **D2.6 (2026-08-08)** — AI 검색 브리지. 일지 `docs/daily/2026-08-08-phase-d2.6.md`,
  근거 `docs/decisions/0008`
  - 고민 입력 → **프롬프트 전문 표시 + 복사** → 구글 AI 모드 / ChatGPT / Claude 중 골라 이동.
    이동 시 클립보드 자동 복사(복사 없이 이동하면 무의미). 앱은 AI 결과를 읽지 않는다
  - 붙여넣기 파서 — `[HOURSTEP]` 블록. 코드펜스·볼드·표·전각 파이프·`"30분"` 흡수,
    줄 단위 실패(전체 실패 아님)
  - 파싱 실패는 에러가 아니라 폴백 — 원문을 둔 채 수동 입력 줄을 준다. 이후 경로는 동일
  - 미리보기에서 확인해야 삽입(직삽입 없음). `source='ai'` 저장 → 마이그레이션 v3
  - vitest **106개** (+ routineParse 20 / aiQuery 11)
- **D2.6 후속 (2026-08-09)** — 간격 입력칸. 마지막 글자를 지우면 `Number('')=0` 이 되어
  값이 시드로 되돌아가던 것 수정. `IntervalInput` 분리(입력 중 문자열 · blur 에서 경계 복구),
  복구 규칙은 `clampIntervalMinutes()` 순수 함수. vitest **109개**. 설치본 0.2.1 로 갱신
- **D2.7 (2026-08-09)** — 행위 시간 + 알림음 + 발화 큐.
  일지 `docs/daily/2026-08-09-phase-d2.7.md`, 근거 `docs/decisions/0009`
  - **행위 시간** `durationSec` (마이그레이션 v4). 0=즉시 행동(물), >0=[완료]가 카운트다운 시작.
    `countdownMs` 와 「1분만 같이 세어볼까요?」 제안 단계(`phase:'offer'`)를 없앴다 —
    셀지 말지는 매번 물을 일이 아니라 설정에서 정할 일
  - **알림음** WebAudio 합성 2종. ① 카드 표시(무조건) / ② 카운트다운 종료(지속 행동만).
    스누즈·건너뛰기·큐 대기·세션 요약은 무음. 재생 주체는 오버레이 창, 설정은 미리듣기만
  - **발화 큐** — 카드가 떠 있는 동안 도래한 알림이 조용히 사라지던 것을 큐로 직렬화.
    병합하지 않음, 상한 5건(오래된 것부터 드롭, `skipped` 기록 없음), 세션 종료 시 폐기
  - `IntervalInput` → `NumberInput` 일반화(간격·행위 시간·AI 미리보기 줄이 같은 칸을 쓴다)
  - vitest **128개** (+ overlayQueue 11 / clampDurationSeconds·시드·볼륨 보강)
- **D2.8 (2026-08-09)** — 디자인 시스템 정립 + UI 점검. 새 기능 없음.
  규격 `docs/design-system.md`, 일지 `docs/daily/2026-08-09-phase-d2.8.md`,
  근거 `docs/decisions/0010`
  - **토큰** `src/styles/tokens.css` — 색·간격(4px 격자)·반경·그림자·타이포(4단)·모션 두 벌.
    `base.css` 가 토큰과 컴포넌트 CSS 를 `@import` 하므로 창별 엔트리는 그대로
  - **대비 3건 수정** (AA 4.5:1): 다크/라이트 `--text-subtle`, 흰 글자 on 주 버튼.
    주 버튼의 세로 그러데이션을 없애고 단색 `--accent` + `--accent-hover` 로
  - **공통 컴포넌트** `src/components/` — Button / NumberField / Checkbox / Card /
    Section / EmptyState. 네 벌로 갈려 있던 버튼(`.ghost`/`.chip`/`.btn`/`.session__toggle`)을
    하나로. Toggle 은 쓰는 자리가 없어 만들지 않았다
  - **리마인더 간격칸 버그** — 마지막 글자를 지우면 기본값 30분으로 되돌아가던 것.
    D2.6 후속에서 행동 간격칸에만 고쳤던 규칙을 `clampIdleReminderMinutes()` 로 통일
  - **설정 창 가로 스크롤 회귀를 캡처가 잡아냈다** — 원인은 `.behavior` 의 암묵 그리드
    트랙(`auto` = max-content). `grid-template-columns: minmax(0, 1fr)` 로 해소
  - 하드코딩 색·여백 잔존을 vitest 가 강제(`src/styles/tokens.test.ts`). vitest **150개**

- **D2.8 후속 (2026-08-09)** — 일지 `docs/daily/2026-08-09-d2.8-followup.md`.
  「AI 열기」 대상 확장. 채팅형 AI 를 **드롭다운**으로 접고
  8곳으로 늘렸다 (영문 이름 알파벳 내림차순: Qwen / Perplexity / Kimi / Grok / Gemini /
  DeepSeek / Claude / ChatGPT). 검색형(구글 AI 모드)만 버튼으로 남는다.
  - 화면 배치는 `kind: 'search' | 'chat'`, URL 주입 가능 여부는 `injectsPrompt` —
    **별개 필드**로 둔다 (`docs/decisions/0008` 갱신분)
  - 채팅형은 전부 `injectsPrompt: false`. 일부가 `?q=` 를 받지만 파라미터가 서비스마다
    다르고 예고 없이 바뀌는데, **틀리면 프롬프트가 조용히 사라진 채 빈 채팅이 열린다**
  - 컨트롤 높이를 토큰화(`--h-sm` / `--h-md`) — 드롭다운이 옆 버튼과 밑선을 맞춰야 했다
  - vitest **155개** (+ 목록 순서·중복·기본값 5)
- **D2.8 후속 2 (2026-08-09)** — 「지우는 중인데 값이 바뀐다」 방어선을 테스트로 덮었다.
  규칙(`빈칸·범위 밖은 위로 올리지 않는다`)이 `NumberField` 안에만 있어 테스트가 닿지
  않았고, 그래서 같은 버그가 두 번(D2.6 간격칸 / D2.8 리마인더칸) 났다.
  `liveNumber()` 순수 함수로 빼고 회귀 케이스를 붙였다. vitest **160개**.
  **동작 변화는 없다** — 리마인더칸은 D2.8(`2eb8576`)에 이미 고쳐져 있었다.
  근거 `docs/decisions/0011`, 진단 기록
  `docs/troubleshooting/fixed-bug-reported-again-version-skew.md`
- **D2.8 후속 3 (2026-08-11)** — 채팅형 AI 드롭다운 정렬을 내림차순 → **오름차순**으로.
  드롭다운 기본값(ChatGPT)이 정렬 순서상 첫 줄과 겹치게 돼서, "첫 줄을 기본값으로 쓰지
  않는다"던 규칙은 없앴다(기본값은 그대로 ChatGPT — 가장 널리 쓰이는 채팅형이라는 이유로).
  vitest 갱신, 회귀 없음
- **D2.8 후속 4 (2026-08-11)** — "트레이" 용어를 사용자 노출 문구에서 전부 제거하고
  "백그라운드에서 실행"으로 바꿨다. 코드·문서 내부 용어로는 유지(규칙 그대로).
  - 트레이 메뉴 "종료" → "완전히 종료" (숨김과 구분)
  - 창을 **처음** 숨길 때(X 닫기·헤더의 [백그라운드에서 실행] 버튼 공통 — 둘 다 Rust 의
    `windows::hide_main` 한 곳으로 모여 `main://hidden` 이벤트를 낸다) Windows 시스템
    토스트로 한 번만 안내(`backgroundNoticeShown` 플래그, `@tauri-apps/plugin-notification`
    신규 의존성). **실측으로 알아낸 것**: WebView2 는 `window.hide()` 로 숨겨도
    `document.hidden`/`visibilitychange` 를 신뢰성 있게 주지 않는다 — 그래서 Page
    Visibility 대신 Rust 가 명시적으로 이벤트를 쏜다
  - [백그라운드에서 실행] 버튼을 하단에서 헤더(설정 버튼 왼쪽)로 옮기고 크기를 키웠다
  - `--debug-cmd main-hide` 를 같은 경로(`windows::hide_main`)를 타도록 바꿔서, 닫기
    2회 → 안내 로그 1회만(`background-notice granted=…`)을 실 DB 에서 검증. 세션·기록은
    만들지 않았다(db-dump 전후 동일)
- **D2.9 (2026-08-11)** — 근거 프로토콜 연결. 마이그레이션 v5. 일지
  `docs/daily/2026-08-11-phase-d2.9.md`, 근거 `docs/decisions/0012`
  - **신체정보**(성별·연령대, 둘 다 선택 입력) — 새 `profile` 싱글턴 테이블. 체중 등은
    수집하지 않는다
  - **물 참고 기준** — `src/core/waterGoal.ts`. KDRIs 2020 확정치가 있는 2조합만 mL 병기,
    나머지는 "하루 5~6잔(200mL 기준)" 단순화. `suggestWaterInterval()` 로 간격 **제안만**
    (자동 변경 금지, 설정에서 [제안 적용])
  - **동작 로테이션** — `src/core/actionRotation.ts`. 스트레칭 카드가 발화마다 동작 카드
    원고 8종(A1~C2)을 순서대로 보여준다. 상태(`action_index`)는 `behaviors` 행에 저장돼
    세션·재시작을 넘어 이어진다. 오버레이 [자세히] → 새 Rust 커맨드
    `show_action_detail` → 메인 창 상세 패널
  - **눈·물 카드 문구**를 임시 지시문에서 원고(D1/E1) 첫 줄로 교체. `is_builtin` 시드에만
    적용 — 기존 설치본 사용자 편집은 「기본값 복원」을 눌러야 바뀐다
  - **근거 보기** — 설정 창 「휴식 루틴」에 `[왜 이 주기인가요?]` 토글
  - vitest **178개** (+ waterGoal 10 / actionRotation 7)
  - **같은 날 후속**: 동작 카드 B2·B4 출처의 "동일 (…)" 축약 표현(로테이션 순서상 맥락이
    끊기는 문제로 지적했던 것)을 수정본으로 교체 — B2·B3·B4 출처를 B1 과 같은 문장으로
    통일, C2 도 "OSHA"→"미국 산업안전보건청(OSHA)"로 표기 통일. 콘텐츠 문구만 바뀌었고
    로테이션 로직·DB 값은 그대로다
- **D2.10 (2026-08-12)** — 동작 목록·선택 + 카운트다운 중 동작 안내. 마이그레이션 v6.
  일지 `docs/daily/2026-08-12-phase-d2.10.md`, 근거 `docs/decisions/0014`
  - **동작 선택** — 새 `action_prefs` 테이블(8종 A1~C2, 전부 켬 시드). 로테이션
    (`actionAt`/`nextActionIndex`)이 꺼진 동작을 건너뛴다. **최소 1개 강제**
    (`canDisable`) — 저장 단계(`normalizeActionPrefs`)와 설정 창 체크박스 양쪽에서 지킨다.
    `behaviors.action_index` 의 의미(8슬롯 고정 인덱스)는 그대로라 마이그레이션이
    로테이션 진행 상태를 건드릴 필요가 없었다
  - **동작 목록 화면** — 설정 창 「휴식 루틴」에 `[동작 목록 보기]`. 8종 체크박스+이름+
    방법+시간+출처, 상단 고정 고지. 메인 창 `ActionDetailCard` 와 방법/시간/출처 줄
    구조를 공유해 그 CSS 를 `components.css` 로 옮겼다(`action-card__*`)
  - **카운트다운 중 동작 안내** — 스트레칭 [완료] → 카운트다운 전환 시 방법 전문 + 시간.
    눈휴식(D1)도 고정 원고(`EYE_REST_METHOD`/`EYE_REST_DURATION`, 원고 그대로 복사)로
    동일 적용. 물은 카운트다운이 없어 해당 없음. 창 확장/원복은 기존 `fitWindow`
    (D1 부터 있던, phase 전환마다 카드 실측 크기로 다시 맞추는 로직) 를 그대로 썼다 —
    새 Win32 코드 없이 `--debug-cmd` 로 540×164→540×219(+55px)→540×164 실측 확인
  - vitest **190개** (+ actionRotation 14: 스킵·최소1개·정규화·손상 케이스)
- **D2.10 후속 (2026-08-12)** — 완전 종료 UX. 메인 창 하단에 [완전히 종료] 버튼 신설
  (`windows::quit_app`, 트레이 [완전히 종료]와 완전히 같은 `app.exit(0)` 경로 — 새 Rust 로직
  없음). 기존 백그라운드 안내 문구(`MAIN.DESCRIPTION`, 임의 수정 안 함)를 버튼 옆으로
  옮기고 `word-break: keep-all` + 문장 경계 `<br/>` 로 어절 중간 개행을 막았다. 트레이 우클릭
  [완전히 종료] 메뉴는 그대로 유지 — 둘 다 같은 커맨드를 부른다.
  - 검증: `tsc --noEmit` / `cargo check` / vitest 190개 전부 통과. 화면 확인은 실행 중이던
    설치본(0.4.1, PID 48792)을 사용자 승인 받아 종료한 뒤 dev 로 `--debug-cmd
    wait:5000,main-show,wait:90000,quit` 로 창을 띄우고 **화면 캡처**(도구 세션 내 인라인
    PowerShell, `EnumWindows`+면적 최댓값으로 진짜 창 골라냄)로 대조 — 버튼이 우측 하단에,
    안내 문구가 어절 안 끊기고 문장 경계에서 줄바꿈되는 것 확인. 클릭 자체는 검증 정책상
    합성 입력이라 하지 않았다(`app.exit(0)` 경로는 트레이 종료·`--debug-cmd quit` 로 이미
    반복 검증된 동일 로직). db-dump 는 하지 않았다 — 이 세션은 세션 시작/종료 명령을 전혀
    보내지 않아 DB 변경 자체가 없다. **설치본은 검증을 위해 종료한 채로 남겨뒀다** — 다시
    쓰려면 수동 실행 또는 재부팅(자동실행) 필요

## 진행 중

없음. **다음 작업은 D3.**

### 남은 자투리

- **D2.10 시각 확인.** 소스에만 있고(설치본 미반영) 화면을 실제로 띄워서 본 적은 없다.
  ① 설정 창 「동작 목록 보기」 패널 — 8개 항목 쌓였을 때 스크롤·간격, 라이트/다크
  ② 카운트다운 중 늘어난 카드(540×219 근방)가 어색하지 않은지, 방법 2줄이 안 잘리는지
- **D2.9 시각 확인.** 0.4.0 설치는 됐지만 아직 화면을 실제로 띄워서 본 적은 없다.
  ① 오버레이 카드에서 동작 이름 + 방법 첫 줄이 540×139 폭에 안 잘리고 읽히는가
  ② 메인 창 동작 상세 패널(`ActionDetailCard`) 배치 ③ 설정 창 신체정보·물 참고 기준
  섹션 레이아웃(라이트/다크 둘 다)

- **D2.8 시각 확인 3건.** 자동 캡처(4화면 × 라이트·다크 8장)로는 문제 없어 보였지만
  DWM 합성 때문에 캡처는 증거일 뿐이다. 눈으로 볼 것:
  ① 라이트에서 오버레이 카드가 **흰 문서/에디터 위**에서도 구분되는가 (그림자가 없다)
  ② 주 버튼이 그러데이션 → 단색으로 바뀐 게 어색하지 않은가
  ③ 본문 15 / 안내 13 / 라벨 12px 3단이 좁게 느껴지지 않는가

- **D2.7 소리를 실제로 들어봐야 한다.** (0.3.0 설치로 이제 도그푸딩 중에 확인할 수 있다.)
  자동 검증은 `sound start/end … state=running` 까지만
  확인한다(웹뷰가 오디오를 재우지 않았다는 증거). 남은 확인: ① 스피커로 실제로 나는가
  ② ①과 ②가 귀로 구분되는가 ③ 기본 볼륨 60 이 적당한가 ④ 다른 소리(음악·통화) 위에서
  거슬리지 않는가
- **D2.7 시각 확인.** 카운트다운 숫자(30px)가 카드에서 읽히는지, 큐에서 이어 뜨는 카드가
  자연스러운지, 설정 창 행동 행이 한 줄 늘어난 뒤에도(행위 시간 + 안내) 볼 만한지
- **검증이 오늘 통계에 세션을 섞었다** — D2.7 이 4건(각 ~4분, `🧪q1`/`🧪q2`), D2.8 이 1건(~5분).
  dev 와 설치본이 같은 DB 를 쓰기 때문. 지우고 싶으면 검증 전 DB 사본이 스크래치패드에 있다
  (`…/scratchpad/db-backup-pre-d2.7` 16:02 시점, `…/db-backup-pre-d2.8` 17:0x 시점).
  D2.8 검증은 행동·설정을 건드린 뒤 **전부 원래 값으로 되돌렸고 덤프로 대조했다**
  (스트레칭 30분/60초, 테마 system, 볼륨 60)
- **0.2.1 로 지내는 동안 `settings` 행이 D2.6 모양으로 덮어써졌다.** 그 빌드에는 알림음
  설정이 없어서 `soundEnabled`/`soundVolume` 이 JSON 에서 빠졌다. 0.3.0 에서
  `normalizeSettings()` 가 기본값(on / 60)으로 채우므로 실사용에는 영향이 없다 —
  0.2.1 에는 볼륨을 바꿀 UI 자체가 없었으니 잃은 값도 없다. **구버전을 다시 띄우면
  같은 일이 반복된다**는 것만 알아둘 것 (dev 와 설치본이 같은 DB 를 쓴다)
- **물마시기 간격이 원래 쓰던 값인지 확인 필요.** 2026-08-09 조사 중 `behavior-restore` 로
  사용자 편집을 덮었다. 스트레칭·눈휴식 30분과 순서는 로그로 복구했지만 물마시기만
  근거가 없어 시드값 30분을 넣어뒀다 (경위: `docs/troubleshooting/dev-and-installed-share-db.md`)
- **D2.6 시각 확인 3건.** ① AI 열기 버튼 3개가 실제로 기본 브라우저에서 각 서비스를 열고
  **클립보드에 프롬프트가 들어가는가**(구글은 URL 에도 실린다) ② **실물** AI 답변을
  붙여넣었을 때 파싱이 통하는가(고정 샘플로만 검증했다) ③ 프롬프트 영역이 읽을 만한가
  — 레이아웃은 `--debug-cmd settings-open:ai` 캡처로 확인했지만 지각 판단은 남는다
- **D2.5 시각 확인이 남았다** (화면이 D2.8 에서 다시 그려졌으니 그 상태로 볼 것):
  1. **라이트 모드에서 오버레이 카드가 밝은 배경 위에서도 구분되는가** (드롭섀도가 없다.
     테두리 + 안쪽 그림자만으로 버틴다 — 흰 문서/에디터 위가 최악의 조건)
  2. 메인 창 타이머·예정 목록 레이아웃 (창 기본 780×780 으로 키웠다)
  3. 설정 창 행동 CRUD 행이 좁지 않은지, 이모지 입력이 제대로 보이는지
- **C-4/C-5 게임명 미기록 + C-5 가 실제 배타적 전체화면이었는지 미확증.**
  D3 「전체화면 감지」 착수 전에 게임 2~3종으로 보강할 것
- **카드 문구에 연구 인용이 없다.** 실존 출처 확보 전까지 추가 금지 (행동 지시만 유지).
  출처가 정해지면 `src/constants/strings.ts` 의 `BEHAVIOR_MESSAGE` 에 한 문장씩 —
  내장 3종의 `is_builtin` 플래그가 그 자리 표시다

## 미결 결정

없음.

## 다음 (D3)

- 드롭섀도 복원 여부 — 되살리려면 여백이 필요하고 그만큼 죽은 영역이 돌아온다.
  커서 폴링(`setIgnoreCursorEvents`) 비용을 다시 계산해서 판단.
  **라이트 모드가 생겨서 우선순위가 올라갔다** (밝은 배경 위 대비가 다크보다 불리하다)
- 전체화면 앱 감지 → 표시 억제/지연
- 다중 모니터 배치 정책 (현재 항상 주 모니터)
- NSIS 인스톨러 폴리싱 + 브랜딩

## 알려진 한계 (현재 남아 있는 것)

1. ~~오버레이 투명 영역이 클릭을 가로챈다~~ → **D1에서 해소**
2. 배타적 전체화면 게임 위 표시 — 2026-08-07 실측에서는 떴다. 게임명·모드 확증은 D3 재확인 대상
3. ~~중복 실행 방지 없음~~ → **D1에서 해소**
4. **오버레이는 항상 주 모니터.** 커서/활성 창 기준 배치는 D3에서 결정
5. **키보드 조작 불가.** `WS_EX_NOACTIVATE` 때문에 카드가 키보드 포커스를 받지 않는다.
   `src-tauri/src/overlay.rs` 의 `KEEP_FOCUS_ON_CLICK` 로 뒤집을 수 있다
6. **동시 due 는 큐로 밀린다** (D2.7 부터 진짜 큐 — `docs/decisions/0009`).
   상한 5건, 넘으면 오래된 것부터 버리고, 세션이 끝나면 대기분은 폐기된다.
   도래 시점에 2분 이상 밀린 것은 여전히 소진 처리(`STALE_MS`) — 큐에 들어가지도 않는다
7. **카드 드롭섀도 없음.** 창이 카드 실크기라 바깥으로 번지는 그림자가 잘린다
   (D1의 맞바꿈 — `docs/decisions/0005`)
8. **설정을 사람이 직접 파일로 고칠 수 없다.** SQLite 안에 있다 (`docs/decisions/0003`)
9. **메인 창의 예정 목록은 정규 스케줄 예정표다.** 오버레이가 들고 있는 스누즈와
   "이미 띄운 것"을 모르므로, 방금 지나간 한 건이 잠깐 남아 보일 수 있다
10. **행동은 최대 20개.** 넘으면 [행동 추가]가 비활성된다
11. **삭제한 행동은 되돌릴 수 없다.** 내장 3종만 「기본값 복원」으로 살아난다 —
    직접 만든 행동에는 확인 대화상자도 실행 취소도 없다
12. **AI 루틴은 복사·붙여넣기 두 번이 사용자 몫이다.** 앱이 구글 결과를 읽지 않으므로
    자동화할 수 없다 (`docs/decisions/0008`). 파서가 실물 답변에서 어디까지 버티는지는
    아직 샘플로만 확인했다

## 결정 기록

| # | 내용 | Phase |
| --- | --- | --- |
| [0001](docs/decisions/0001-overlay-show-hide-win32.md) | 오버레이 show/hide 는 raw Win32 로 (tao visible 캐시 우회) | D0 |
| [0002](docs/decisions/0002-debug-cmd-hook.md) | GUI 자동 검증은 `--debug-cmd` 훅으로 (합성 입력 금지) | D0 |
| [0003](docs/decisions/0003-settings-storage-sqlite.md) | 설정도 SQLite 에 (store 플러그인 대신) | D2 |
| [0004](docs/decisions/0004-rust-clock-ts-judgment.md) | 시계는 Rust, 판단은 TS | D1 |
| [0005](docs/decisions/0005-overlay-window-fits-card.md) | 오버레이 창을 카드 실크기로 (커서 폴링 대신) | D1 |
| [0006](docs/decisions/0006-completion-log-label-snapshot.md) | 삭제된 행동의 기록은 이름 스냅샷으로 (FK SET NULL 대신) | D2.5 |
| [0007](docs/decisions/0007-behaviors-runtime-source-db.md) | 행동의 런타임 소스는 DB, 시드는 TS 코드 | D2.5 |
| [0008](docs/decisions/0008-ai-search-bridge-copy-paste.md) | AI 루틴은 딥링크 + 복사·붙여넣기로 (앱이 결과를 읽지 않는다) | D2.6 |
| [0009](docs/decisions/0009-overlay-queue-serialize.md) | 겹친 발화는 병합하지 않고 큐로 직렬화 | D2.7 |
| [0010](docs/decisions/0010-design-tokens-and-css-guardrail.md) | 디자인 값은 토큰 한 곳에서만, 위반은 stylelint 대신 vitest 로 | D2.8 |
| [0011](docs/decisions/0011-ui-rules-as-pure-functions.md) | 화면 동작 규칙은 컴포넌트가 아니라 순수 함수에 (테스트가 닿게) | D2.8 후속 |
| [0012](docs/decisions/0012-action-rotation-state-and-profile-table.md) | 동작 로테이션 상태는 behaviors 행에, 신체정보는 별도 profile 테이블에 | D2.9 |
| [0013](docs/decisions/0013-main-hidden-signal-not-page-visibility.md) | 창 숨김 판단은 Page Visibility 대신 Rust 의 명시적 이벤트로 | D2.8 후속 |
| [0014](docs/decisions/0014-action-prefs-table-and-countdown-resize-reuse.md) | 동작 선택은 별도 `action_prefs` 테이블에, 카운트다운 창 확장은 기존 `fitWindow` 재사용 | D2.10 |
