# 0007. 행동의 런타임 소스는 DB, 시드는 TS 코드 (마이그레이션 SQL 이 아니라)

- 날짜: 2026-08-08
- Phase: D2.5
- 상태: 채택
- 관련: `src-tauri/src/db.rs` (마이그레이션 v2), `src/data/db.ts` (`seedBehaviorsIfEmpty`),
  `src/core/presets.ts`, `src/core/behaviors.ts`, `src/core/settings.ts`,
  `docs/decisions/0003-settings-storage-sqlite.md`

## Problem

D2 까지 행동은 **코드에 하드코딩된 프리셋 3종**이었고, 설정 JSON 이 그 위에 on/off·간격만
덧씌웠다(`applySettings`). D2.5 는 사용자가 행동을 **만들고 지우게** 한다. 개수도 이름도
문구도 사용자 것이 되므로 "프리셋 + 덮어쓰기" 모델은 더 못 쓴다.

그러면 두 가지를 정해야 한다.

1. 행동을 어디에 저장하나 — 설정 JSON 안? 별도 테이블?
2. 기본 3종(🧘/💧/👀)을 **어디서** 심나 — 마이그레이션 SQL? TS 어댑터?

## Decision

### 1. `behaviors` 테이블 신설, 설정 JSON 에서 행동을 뺀다

0003 은 "설정은 JSON 한 덩어리로" 였고 그건 유효하다 — 하지만 그건 **개수가 고정된
스칼라 설정** 얘기였다. 행동은 이제 가변 길이 컬렉션이고, 정렬·삭제·개별 갱신이 있다.
JSON 통짜로 두면 통계 조인도, 순서 보존도 전부 손으로 해야 한다.

`AppSettings` 에는 행동에 속하지 않는 것만 남았다: `idleReminder*`, `theme`.

### 2. 시드는 마이그레이션 SQL 이 아니라 TS 어댑터에서

마이그레이션 v2 는 **DDL 만** 한다. 표가 비어 있으면 `src/data/db.ts` 의
`seedBehaviorsIfEmpty()` 가 `src/core/presets.ts` 의 `seedBehaviors()` 를 넣는다.

이유:

- 시드 값(간격·이모지·문구)의 단일 출처가 한 곳이어야 한다. SQL 에 INSERT 를 박으면
  같은 값이 Rust 마이그레이션과 TS 「기본값 복원」 두 군데에 존재하고, 반드시 갈라진다.
  지금은 복원 버튼과 최초 시드가 **같은 함수**를 부른다
- 문구는 `src/constants/strings.ts` 에 있다(CLAUDE.md 규칙 8). Rust SQL 문자열에
  한국어 카피를 복붙하면 그 규칙이 깨진다
- 마이그레이션은 되돌릴 수 없지만 시드는 조건부다. "비어 있으면"이라는 판단이
  SQL 보다 코드에서 훨씬 읽기 쉽다

창 세 개가 각자 부팅하며 동시에 부르므로 `INSERT OR IGNORE` 로 넣는다 — 겹쳐도 무해하다.

### 3. v1 설정 JSON 의 행동 설정은 한 번만 흡수하고 버린다

기존 사용자의 on/off·간격을 잃지 않기 위해, 시드 시점에 D2 설정 JSON 의 `behaviors`
배열을 읽어 덮어쓴다(`extractLegacyBehaviors` → `applyLegacyBehaviorSettings`).
그 뒤 정규화된 설정을 다시 저장하면 `normalizeSettings` 가 그 필드를 버리므로
낡은 키는 자동으로 사라진다 — 삭제 쿼리를 따로 쓰지 않는다.

실측 (2026-08-08, `--debug-cmd behaviors-dump`): v1 DB 에 물마시기 13분 / 눈휴식 off 를
심어두고 v2 로 올린 결과
`behaviors n=3 0:stretch(🧘스트레칭,50m,on,builtin) 1:water(💧물마시기,13m,on,builtin) 2:eyes(👀눈휴식,60m,off,builtin)`
— 세션·기록도 그대로였다 (`db sessions=1 ... logs=0`).

## Consequences

- `applySettings()` 가 없어졌다. 스케줄러에 넘길 목록은 `db.loadBehaviors()` 하나뿐이다
- **DB 값을 그대로 믿지 않는다.** `loadBehaviors()` 는 항상 `normalizeBehaviors()` 를
  통과시킨다 — 설정 창(사용자 입력)과 DB(구버전·손상) 둘 다 신뢰 경계다
- `is_builtin` 플래그가 생겼다. 지금 하는 일은 「기본값 복원」의 대상 표시와 목록의 "기본"
  뱃지뿐이지만, 근거 기반 프로토콜을 붙일 자리로 남겨둔 것이다
  (실존 출처 확보 전까지 인용 문구 금지 — CLAUDE.md 규칙 6 그대로)
- 시드가 `constants/strings.ts` 를 import 하므로 `src/core/` → `src/constants/` 방향
  의존이 생겼다. 순수 상수라 코어의 "IO 금지" 규칙에는 걸리지 않는다
