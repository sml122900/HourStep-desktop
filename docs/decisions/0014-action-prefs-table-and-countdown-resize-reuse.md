# 0014. 동작 선택은 별도 `action_prefs` 테이블에, 카운트다운 창 확장은 기존 `fitWindow` 재사용

- 날짜: 2026-08-12
- Phase: D2.10
- 상태: 채택
- 관련: `src-tauri/src/db.rs`(마이그레이션 v6), `src/core/actionRotation.ts`,
  `src/data/db.ts`, `src/windows/overlay/OverlayWindow.tsx`,
  `src/windows/settings/SettingsWindow.tsx`, `docs/decisions/0012`

## Problem

D2.10 은 두 가지를 묶는다: ① 동작 로테이션 8종 중 일부를 끌 수 있게 하기 ② 카운트다운
중 카드가 방법 전문을 보여줄 수 있도록 창을 키웠다 줄이기. 저장 위치와 리사이즈 구현
방식 둘 다 열려 있었다.

## Decision

### 동작 선택 → 새 `action_prefs` 테이블 (id 는 content id, `behaviors` 행이 아니다)

`behaviors.action_index`(D2.9, `docs/decisions/0012`)와 헷갈리기 쉽지만 성격이 다르다.
`action_index` 는 "지금 몇 번째냐"는 **스트레칭이라는 한 행동에 속한 상태**고,
`action_prefs` 는 "그 8종 각각을 쓸지 말지"라는 **콘텐츠(A1~C2) 자체에 속한 설정**이다.
`behaviors` 테이블에 열을 얹지 않은 이유:

- `behaviors` 행은 사용자가 CRUD 하는 대상이고 8종 로테이션은 스트레칭 하나에만 종속된
  콘텐츠 세부사항이다. 8개 열을 `behaviors.stretch` 행에 우겨넣거나 JSON 으로 얹으면
  `normalizeBehaviors`/`saveBehaviorsAndBroadcast` 의 무거운 왕복(행동 CRUD 전체 재정렬·
  재검증·방송)을 매번 타야 한다 — 체크박스 하나 누르는 것치고 과하다
- `profile`(D2.9) 과 같은 결로 판단했다: 성격이 다른 데이터는 성격이 다른 테이블에 둔다.
  다만 `profile` 은 방송하지 않는 반면(설정 창만 읽고 쓴다), `action_prefs` 는 **오버레이의
  실행 중 로테이션 판단에 직접 쓰이므로** 전용 방송 이벤트(`ACTION_PREFS_CHANGED`)가 필요했다

행 id 는 `behaviors.id` 가 아니라 `ROTATION_ORDER`(`A1`~`C2`, 콘텐츠 원고의 키)다. 시드는
`db.rs` 마이그레이션 SQL 에 8개 `INSERT OR IGNORE` 로 직접 박아 뒀다 — `behaviors` 처럼
TS(`presets.ts`)가 시드를 들고 어댑터가 최초 1회 심는 방식을 따르지 않은 이유는 이 8개
값이 `docs/content/hourstep-action-cards.md` 원고에 고정된 상수이고(콘텐츠가 바뀌지 않는 한
바뀌지 않는다), 「기본값 복원」류 되돌리기 기능도 필요 없기 때문이다. 최소 1개 강제는
저장 경로(`normalizeActionPrefs`)에도 방어망을 뒀다 — 손상되거나(전부 0) UI 가드를
우회해 들어온 값도 첫 항목을 강제로 켠다.

### `actionAt`/`nextActionIndex` 는 여전히 고정 8슬롯 인덱스 공간에서 논다

꺼진 동작만 걸러낸 새 배열을 순회하는 대신, 원래 8칸 배열에서 "이 자리가 꺼져 있으면
다음 켜진 자리까지 민다"는 스킵 로직을 얹었다(`enabledIds` 파라미터, 기본값은 8개 전부).
그래서:

- `behaviors.action_index` 의 의미(ROTATION_ORDER 안의 절대 위치)가 D2.9 이후 전혀
  바뀌지 않는다 — v5→v6 마이그레이션이 `action_index` 값을 단 하나도 건드릴 필요가 없었다
  ("마이그레이션 후 로테이션 인덱스 보존"이 설계상 자동으로 성립한다, 별도 코드 불필요)
- 순서 자체("일어나기·목·손목을 고루 섞는다")는 그대로 두고 골라내기만 한다는 원고의
  「배치 제안」 문장을 문자 그대로 구현할 수 있었다

### 카운트다운 중 창 확장/원복 — 새 Win32 코드를 안 썼다

`OverlayWindow.tsx` 의 `fitWindow` 는 D1(`docs/decisions/0005`)부터 카드가 실제로
렌더링된 크기를 `getBoundingClientRect()` 로 측정해 창을 맞추고, `phase` 가 바뀔 때마다
(`useLayoutEffect` 의존성에 이미 있었다) 다시 실행된다. 카운트다운 중 방법 전문·시간을
카드 안에 그냥 더 그리면 — 별도 리사이즈 로직을 추가하지 않아도 — 다음 `fitWindow` 호출이
늘어난 카드 높이를 그대로 측정해 창을 키우고, 카운트다운이 끝나 카드가 다시 짧아지면
다음 표시 때 다시 작게 잰다. `--debug-cmd` 로 실측: 카드 단계 540×164 → 완료 눌러
카운트다운 진입 540×219(+55px, 방법 2줄+시간 줄만큼) → 카운트다운 종료 후 다음 표시에서
다시 540×164 로 원복. "Win32 SetWindowPos 경로 재사용"은 이미 `fitWindow` 가 부르는
`appWindow.setSize()`(Tauri 표준 API, 내부적으로 `SetWindowPos` 를 호출한다)가 그 경로다 —
`show_overlay_noactivate`/`hide_overlay` 처럼 raw Win32 를 직접 호출하는 새 커맨드를
따로 만들 이유가 없었다. 클릭 차단 영역이 항상 카드 실크기와 같다는 D2.5 원칙도 그대로
유지된다 — 측정-후-리사이즈이므로 애초에 어긋날 수가 없는 구조다.

## Consequences

- 새 IPC 이벤트 `action-prefs://changed` 가 하나 늘었다. 지금은 오버레이만 구독한다
  (설정 창은 자기 편집이라 방송을 무시하고, 메인 창은 로테이션 판단에 관여하지 않는다)
- `--debug-cmd behaviors-dump` 출력에 `shown=<id>` 를 덧붙였다 — 저장된 `action_index`
  가 꺼진 자리를 가리켜도 실제로 카드에 뜰 동작이 무엇인지 클릭 없이 바로 보인다
  (`actionAt(index, enabledIds)` 를 그대로 호출한 결과라 화면 로직과 검증 로직이 갈리지 않는다)
- `--debug-cmd action-toggle:<id>=<on|off>` 도 설정 창과 같은 `canDisable` 가드를 탄다 —
  마지막 1개를 끄려 하면 저장하지 않고 거부 로그만 남긴다
