# `--debug-cmd` 명령을 `wait` 없이 연달아 보내면 도착 순서가 뒤바뀐다 — 실 데이터에 테스트 세션이 남았다

- 날짜: 2026-08-12 (Phase D2.10)
- 환경: Windows 11, 도그푸딩 기기(개발 PC = 사용 PC), `pnpm tauri dev -- -- -- --debug-cmd`
- 관련: `CLAUDE.md` 「검증 정책 → 운영 세부」, `src-tauri/src/debug_cmd.rs`,
  `docs/troubleshooting/dev-and-installed-share-db.md`

## 문제 상황

D2.10(동작 선택) 검증 스크립트를 짜면서 상태를 확인하는 명령 여러 개를 `wait` 없이
한 번에 이어 붙였다.

```
db-dump,action-prefs-dump,action-toggle:A1=off,action-prefs-dump,start-session, ...
```

실행 결과, `action-toggle:A1=off` **이전**에 보낸 `action-prefs-dump` 응답과
**이후**에 보낸 `action-prefs-dump` 응답이 **똑같이 "전부 켬"**으로 찍혔다.
토글이 안 먹었나 싶었지만, 뒤이어 온 토글의 자체 확인 로그(`action-prefs toggle
n=8 A1:off ...`)는 정확히 A1 이 꺼졌다고 말하고 있었다 — 결과 자체는 맞는데
**로그가 찍힌 순서만 이상했다.**

## 시도한 것들

**① "토글 로직이 비동기라 실패했다"는 가설을 먼저 의심.** `debugActionPref()` 코드를
다시 읽어 봤지만 `await db.loadActionPrefs()` → `await db.saveActionPrefsAndBroadcast()`
순서는 맞았다. 로직 자체는 문제가 없었다.

**② 각 debug-cmd 명령이 실제로 어떻게 실행되는지 짚었다.** Rust 쪽 `run_step()` 은
`db-dump`/`action-prefs-dump`/`action-toggle` 모두 `app.emit_to(overlay::OVERLAY_LABEL, ...)`
로 **이벤트만 쏘고 끝난다** — 응답을 기다리지 않는다. 실제 처리는 오버레이 웹뷰의
`listen()` 콜백(전부 `async` 함수)이 하고, 완료되면 `invoke('log_debug', ...)` 로
Rust stdout 에 결과를 되돌려 보낸다. 즉 Rust 쪽에서 명령을 순서대로 **보내는** 것과
JS 쪽에서 그 처리가 **끝나는** 순서는 별개다.

**③ 왜 순서가 뒤집혔는지 계산.** `action-prefs-dump` 는 `loadActionPrefs()` 한 번
(짧은 SELECT)로 끝나지만, `action-toggle` 은 `loadActionPrefs()` → `canDisable()` 판단
→ `saveActionPrefsAndBroadcast()`(UPDATE 8회 + `emit`) 까지 거친다. `wait` 없이
거의 동시에 쏘면, **더 짧은 비동기 체인이 더 긴 체인보다 먼저 끝날 수 있다** —
토글이 완료되기 전에 두 번째 dump 가 먼저 DB 를 읽어 옛 값을 돌려준 것이다.

**④ 이게 그냥 로그 순서 문제로 끝나지 않는다는 걸 뒤늦게 확인.** 같은 스크립트 안에
`start-session`/`done`/`end-session` 이 섞여 있었는데, 이 셋도 `wait` 없이 다른
명령들 사이에 끼어 있었다. 스크립트가 끝난 뒤 실 DB 를 대조해 보니 세션 1건·완료
기록 1건(`🧘 스트레칭`, 약 3초)이 실제로 남아 있었다 — 로그 순서만 헷갈린 게
아니라 **비동기 완료를 기다리지 않고 다음 명령(결국 `quit`)이 먼저 도착해** 뒷정리가
꼬인 결과였다.

## 원인

`--debug-cmd` 의 상태 변경 명령은 전부 Rust → 오버레이 웹뷰로의 **비동기 이벤트
왕복**이다. Rust 의 `run_step()` 은 이벤트를 보내기만 하고 응답을 기다리지 않으므로,
**명령을 보낸 순서가 처리(완료)된 순서를 보장하지 않는다.** 스크립트에 `wait` 가
없으면 여러 이벤트가 동시에 오버레이로 들어가고, 각자의 async 체인 길이에 따라
먼저 도착한 게 나중에 끝날 수 있다.

## 최종 해결법

1. **상태를 바꾸는 명령 사이마다 `wait` 를 넣는다.** 읽기 전용 명령(`dump`/
   `*-dump`)도 직전 쓰기 명령의 응답을 확인하려는 목적이면 마찬가지로 `wait` 를
   넣어야 신뢰할 수 있다
2. **세션을 만드는 검증은 최대한 세션 없이 한다.** `dismiss()` 는 활성 세션이
   없으면 `CompletionLog` 를 안 남기므로(`OverlayWindow.tsx`), `overlay-show`/
   `done`/`skipped` 만으로 로테이션·카운트다운 동작을 검증하면 실 데이터에 아무
   흔적도 남기지 않는다 — 애초에 `start-session` 을 쓸 이유를 줄이는 쪽이 `wait`
   를 챙기는 것보다 근본적인 예방이다
3. 이미 오염된 실 데이터는 `docs/troubleshooting/sqlite3-cli-non-ascii-path.md`
   방식으로 직접 확인하고 지웠다 — `started_at`/`session_id`/`at` 을 대조해
   정확히 그 세션·로그 한 줄만 골라 지우고, 앱 자체의 `db-dump` (raw SQL 이 아니라
   정규화 경로) 로 원래 값 복귀를 재확인했다
4. 재발 방지 규칙을 `CLAUDE.md` 「검증 정책 → 운영 세부」에 한 줄로 남겼다 —
   다음 Phase 가 같은 실수를 하기 전에 먼저 읽게 하는 게 목적이다

## 이력서 소재 한 줄

> 자체 개발한 디버그 자동화 훅에서 비동기 이벤트 왕복의 완료 순서가 전송 순서를
> 보장하지 않는다는 걸 실측으로 발견하고, 그로 인해 실 프로덕션 데이터에 남은
> 테스트 흔적을 정확히 특정해 제거·재검증했으며, 같은 실수가 재발하지 않도록
> 프로젝트 운영 규칙 문서에 근거와 함께 기록.

## 관련

- `docs/troubleshooting/dev-and-installed-share-db.md` — dev 와 설치본이 같은
  DB 를 쓴다는, 이번 사고와 같은 뿌리의 함정
- `docs/troubleshooting/sqlite3-cli-non-ascii-path.md` — 이번 정리 작업 중
  같이 걸린 두 번째 함정
- `docs/daily/2026-08-12-phase-d2.10.md`
