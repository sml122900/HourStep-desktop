# 0012. 동작 로테이션 상태는 `behaviors` 행에, 신체정보는 별도 `profile` 테이블에

- 날짜: 2026-08-11
- Phase: D2.9
- 상태: 채택
- 관련: `src-tauri/src/db.rs`(마이그레이션 v5), `src/core/actionRotation.ts`,
  `src/core/waterGoal.ts`, `src/windows/overlay/OverlayWindow.tsx`,
  `docs/content/hourstep-evidence-archive.md`, `docs/content/hourstep-action-cards.md`

## Problem

D2.9 프롬프트(`docs/content/phase-d2.9-prompt.md`)가 신체정보와 동작 로테이션 둘 다
"마이그레이션 v5"로 묶어 요구했지만 저장 위치는 열어 뒀다:

- 신체정보(성별·연령대): "settings **또는** profile 테이블" 중 택일
- 동작 로테이션 상태(마지막 인덱스): "DB" 라고만 명시, 어느 테이블인지는 없음

## Decision

### 신체정보 → 새 `profile` 테이블 (싱글턴 행)

`settings` 테이블의 불투명 JSON 한 덩어리(`docs/decisions/0003`)에 얹지 않고
`sex`/`age_group` 열을 가진 별도 테이블을 만들었다.

- `settings` 블롭은 "행동 아닌 앱 설정"(테마·알림음·리마인더)이 사는 곳이다. 신체정보는
  성격이 다르다 — 사용자 개인 정보이고, 비전 로드맵의 Supabase 동기화가 오면 계정에
  붙는 열 단위 데이터로 다뤄질 가능성이 크다. JSON 블롭에 묻어 두면 그때 다시 꺼내야 한다
- 구조가 단순하다(선택 필드 2개, 싱글턴 행) — `settings`·`behaviors` 처럼 매번
  `INSERT OR REPLACE ... WHERE id = 1` 로 왕복하면 되고 새 로직이 거의 없다

### 동작 로테이션 인덱스 → `behaviors.action_index` 컬럼

세션이나 설정이 아니라 **그 행동 자체에 속하는 사실**이라고 봤다. `duration_sec`(D2.7)과
같은 결 — "이 행동을 어떻게 다룰지"의 일부다. 그래서 새 테이블도, `settings` 블롭도
아니고 `behaviors` 행에 열 하나(`action_index INTEGER DEFAULT 0`)를 더했다.

- 지금은 내장 스트레칭(`id === 'stretch'`) 하나만 쓴다. 다른 행동에는 항상 0 — 의미 없는
  값이지만 해롭지도 않다 (`actionRotation.actionAt()` 이 어떤 정수든 안전하게 감싸 읽는다)
- 발화마다(=`OverlayWindow.dismiss()` 호출마다) 전진하고 `db.saveActionIndex()` 로
  **그 값 하나만** 조용히 쓴다. 전체 행동 목록을 다시 정규화·저장하는
  `saveBehaviorsAndBroadcast()` 를 쓰지 않는 이유 — 그 경로는 `BEHAVIORS_CHANGED` 를
  방송해 다른 창의 스케줄 재계산을 깨우는데, 로테이션 전진은 어느 창의 스케줄도 바꾸지
  않는다. 매 발화 불필요한 방송이 나가는 걸 막았다

### 스트레칭 카드는 `message` 필드를 더 이상 읽지 않는다

D2.5 부터 `Behavior.message` 가 카드 문구의 런타임 소스였지만, D2.9 부터
`id === 'stretch'` 인 카드는 이 값을 **무시**하고 `actionRotation.actionAt()` 이 주는
오늘의 동작(이름 + 방법 첫 줄)을 대신 보여준다 (`OverlayWindow.tsx` 의 `BehaviorCard`).

이게 이번 Phase 의 핵심이라 의도된 예외다 — "행동 지시 문구 한 줄"에서 "근거 있는 동작
로테이션"으로 옮겨가는 게 D2.9 의 목적 자체다. `strings.ts` 의 `BEHAVIOR_MESSAGE.stretch`
는 폴백·목록 표시용으로만 남는다.

## Consequences

- `Behavior` 도메인 타입에 `actionIndex: number` 가 늘었다. `normalizeBehavior` 는 범위를
  접지 않고(음이 아닌 정수만 보장) 읽을 때 `actionAt()` 이 감싼다 — 손상값 방어를
  한 곳에만 둔다
- `profile` 은 다른 창에 방송하지 않는다. 설정 창만 읽고 쓰고, 스케줄·오버레이는 신체정보를
  몰라도 된다(물 참고 기준 계산은 설정 창 안에서 끝난다)
- 검증(2026-08-11, 실 도그푸딩 DB 대상): `--debug-cmd db-dump`/`behaviors-dump` 로
  v4→v5 마이그레이션 전후 `sessions=11 logs=54 behaviors=3` 그대로임을 확인했고,
  `overlay-show:stretch` → `done` 을 두 번 반복해 `action=0→1→2` (A1→B1→B2, 로테이션
  순서 그대로) 전진을 stdout 으로 확인했다. 세션·기록은 만들지 않았다
  (활성 세션이 없으면 `CompletionLog` 저장이 건너뛰어진다 — `dismiss()` 의 기존 동작)
