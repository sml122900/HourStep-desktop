# 0003. 설정도 SQLite 에 저장한다 (store 플러그인 대신)

- 날짜: 2026-08-07
- Phase: D2
- 상태: 채택
- 관련: `src-tauri/src/db.rs`, `src/data/db.ts`, `src/core/settings.ts`

## Problem

D2 에서 저장해야 할 것이 두 종류다.

1. **기록** — `work_sessions`, `completion_logs`. 구간 질의·집계가 필요하다
2. **설정** — 행동별 on/off·간격, 미시작 리마인더. 사실상 키-값 하나

1번은 SQLite 가 자명하다. 2번을 어디에 둘지가 결정 사항이었다.
후보는 `tauri-plugin-store`(JSON 파일) 와 SQLite `settings` 테이블.

## Options

### store 플러그인

- 키-값에 딱 맞고 API 가 가볍다 (`store.set('key', value)`)
- 사람이 읽고 고칠 수 있는 JSON 파일
- 하지만 **의존성이 하나 더 늘고**, 저장소가 두 군데가 된다

### SQLite `settings(key, value)` 테이블

- 이미 붙이는 의존성 안에서 해결된다
- 백업·초기화·마이그레이션 경로가 **한 파일(`hourstep.db`)로 통일**된다.
  "설정만 남기고 기록 지우기" 같은 것도 한 트랜잭션으로 된다
- 스키마 변경 시 `MigrationKind::Up` 이라는 버전 관리 수단이 이미 있다.
  store 플러그인에는 마이그레이션 개념이 없어서 구버전 JSON 처리를 직접 짜야 한다
- 키-값 하나 넣자고 테이블을 파는 건 과한 느낌이 있다

## Decision

**SQLite `settings` 테이블에 `app_settings` 키 하나로 JSON 을 통째 저장한다.**

결정적인 이유는 **마이그레이션과 백업 경로의 단일화**다. 이 앱은 D3 이후 Supabase 동기화가
로드맵에 있고(CLAUDE.md 비전), 그때 "무엇을 올릴 것인가"의 답이 파일 하나면 훨씬 단순하다.
저장소가 둘이면 그 시점에 반드시 합치게 된다 — 지금 합쳐두는 게 싸다.

키를 잘게 쪼개지 않고 JSON 한 덩어리로 넣은 것은 설정이 **항상 통째로 읽고 통째로 쓰이기**
때문이다. 부분 갱신 요구가 생기면 그때 열을 나누면 된다.

## Consequences

- 설정 읽기는 JSON 파싱을 거친다. **파싱 실패가 앱을 못 켜게 만들면 안 되므로**
  `loadSettings()` 는 실패 시 기본값으로 살아난다 (`src/data/db.ts`)
- 저장된 값을 그대로 믿지 않는다. `normalizeSettings()` 가 범위 밖·타입 불일치·
  프리셋에 없는 항목을 전부 정리한다. 설정 창은 사용자 입력이 들어오는 신뢰 경계다
- 사람이 직접 설정 파일을 고치는 건 어려워졌다. 필요해지면 설정 내보내기/가져오기를
  만드는 편이 낫지 D3 이전에 store 로 되돌릴 이유는 없다
