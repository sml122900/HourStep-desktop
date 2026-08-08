# 0006. 삭제된 행동의 과거 기록은 이름 스냅샷으로 보존한다 (FK SET NULL 대신)

- 날짜: 2026-08-08
- Phase: D2.5
- 상태: 채택
- 관련: `src-tauri/src/db.rs` (마이그레이션 v2), `src/data/db.ts`, `src/core/types.ts`
  (`CompletionLog.behaviorLabel`), `src/windows/main/MainWindow.tsx`,
  `src/windows/overlay/OverlayWindow.tsx`

## Problem

D2.5 부터 행동은 사용자가 만들고 **지운다.** 그런데 `completion_logs` 는 행동을 지운
뒤에도 남아야 한다 — 지난주 실천율에서 "물마시기 12/15" 가 사라지면 통계가 거짓말이 된다.

문제는 그 기록에 붙일 **이름**이다. `completion_logs.behavior_id` 만 있으면,
행동이 지워진 순간 화면에 띄울 게 `water` 같은 내부 id 밖에 안 남는다.
직접 만든 행동은 id 가 `b-1754...` 라서 그마저도 사람이 읽을 수 없다.

계획서(D2.5 §3)가 선택지를 둘로 좁혀놨다: **FK + `ON DELETE SET NULL`** 또는
**이름 스냅샷 컬럼**. 하나 고르고 근거를 남기기로 한 항목이다.

## Options

### A. `behavior_id` 에 FK + `ON DELETE SET NULL`

행동을 지우면 과거 기록의 `behavior_id` 가 NULL 이 된다.

- 기록 자체(건수·시각·action)는 남는다 → 전체 실천율은 보존된다
- **행동별 집계가 무너진다.** 지워진 행동 5종의 기록이 전부 하나의 NULL 무더기로 합쳐져,
  "어떤 행동이었는지"를 되살릴 방법이 아예 없다. 되돌릴 수 없는 손실이다
- SQLite 는 `PRAGMA foreign_keys` 가 **연결마다 기본 OFF** 다. `tauri-plugin-sql` 은
  sqlx 풀에서 연결을 꺼내 쓰므로 모든 연결에 켜져 있다고 믿기 어렵다.
  켜지지 않으면 SET NULL 은 조용히 동작하지 않고 고아 행이 남는다 — 최악의 실패 모드다
- 기존 v1 데이터에 FK 를 붙이려면 SQLite 특성상 테이블 재생성(12단계 절차)이 필요하다

### B. 기록 시점의 이름을 컬럼에 스냅샷

`completion_logs.behavior_label TEXT NOT NULL DEFAULT ''` 를 추가하고,
`insertLog` 가 그때의 `이모지 + 이름` 을 같이 넣는다. `behavior_id` 는 그대로 둔다.

- 행동을 지워도 `behavior_id` 로 **행동별 집계가 계속 된다**
- 화면에 띄울 이름도 남는다
- 마이그레이션이 `ALTER TABLE ADD COLUMN` 한 줄
- 기록은 원래 "그때 무슨 일이 있었나"라서, 지금 이름이 아니라 **그때 이름**이 맞다

## Decision

**B — 이름 스냅샷.**

결정적인 건 "이름이 남느냐"가 아니라 **행동별 집계가 남느냐**였다. A 는 삭제 한 번으로
과거 통계의 축 하나를 영구히 잃는다. 통계가 D2 의 결과물인데 D2.5 의 삭제 기능이
그걸 지우게 둘 수는 없다.

FK 를 아예 걸지 않은 것도 의도다. `behavior_id` 는 참조가 아니라 **집계 키**로 쓴다 —
가리키는 행이 사라져도 값 자체는 계속 의미가 있다.

## Consequences

- 이름을 바꾸면 그 이후 기록만 새 이름을 갖는다. 같은 행동이 통계에서 두 이름으로
  보이지 않는 이유는 표시 이름을 `behavior_id` 로 모아 고르기 때문이다 — 살아 있는
  행동은 **현재 이름**을, 지워진 행동만 마지막 스냅샷을 쓴다
  (`MainWindow.labels`, `OverlayWindow` 세션 요약)
- v1 시절 기록에는 스냅샷이 없다(`''`). 그 경우 `behaviorLabel` 은 `undefined` 가 되고
  화면에는 id 가 뜬다. 내장 3종은 지워지지 않는 한 현재 이름으로 잘 보인다
- 라벨은 표시 전용이다. **집계·판정에 쓰지 않는다** — 쓰기 시작하면 이름 변경이
  통계를 쪼개는 버그가 된다
- `db-dump` 에 `labeled=` 카운트를 넣어 스냅샷이 실제로 기록되는지 훅으로 볼 수 있게 했다
