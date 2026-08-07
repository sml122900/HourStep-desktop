# 0005. 오버레이 창을 카드 실크기로 맞춘다 (커서 폴링 대신)

- 날짜: 2026-08-07
- Phase: D1
- 상태: 채택
- 관련: `src/windows/overlay/OverlayWindow.tsx` (`fitWindow`), `src/windows/overlay/overlay.css`,
  `docs/decisions/0001-overlay-show-hide-win32.md`

## Problem

D0 에서 「알려진 한계 1」로 남긴 것: **오버레이 창의 투명 영역도 클릭을 가로챈다.**

창은 640×240 인데 카드는 540×139 다. 나머지는 CSS 상 투명하지만 Win32 히트테스트는
`pointer-events` 를 모른다. 히트테스트로 실측한 결과 카드 위·카드 배경·투명 영역이
전부 `HourStep Overlay` 를 반환했다. 카드가 떠 있는 8초 동안 화면 상단 중앙
640×240 사각형이 뒤 창의 클릭을 통째로 막는다는 뜻이다.

D0 검증에서 카드가 **게임·영상 전체화면 위에도 뜬다**는 게 확인되면서 방해 정도가
예상보다 커졌고, D1 편입이 확정됐다.

## Options

### A. 커서 추적 + `setIgnoreCursorEvents` 토글 (원래 계획, "정공법")

커서가 카드 밖이면 클릭 통과를 켜고, 안이면 끈다.

**함정**: 클릭 통과를 켜는 순간 그 창은 마우스 이벤트를 못 받는다.
즉 **커서가 카드로 돌아온 걸 웹뷰가 감지할 수 없다.** 결국 Rust 쪽에
`GetCursorPos` 폴링 스레드가 필요하다 — 카드가 떠 있는 동안 60ms 주기 정도.

### B. 창을 카드 실크기로 축소 (D1 계획서의 "차선책")

표시할 때마다 카드를 실측해서 창을 그 크기로 맞춘다.
폴링도 토글도 없고, 죽은 영역이 **줄어드는 게 아니라 0이 된다.**

## Decision

**B 를 택한다.**

A 는 "정공법"이라 적어뒀지만, 실제로 뜯어보니 폴링 스레드가 필수라서 더 이상 정공법이
아니었다. B 는 상태 기계도 스레드도 없이 문제를 없앤다.

실측 (1920×1080, 100% 배율):

```
overlay RECT = (690, 0) 540x139        ← D0: (640, 0) 640x240
카드 안쪽  (960, 70)  -> HourStep Overlay
카드 왼쪽  (650, 70)  -> Unity 에디터
카드 오른쪽(1270, 70) -> Unity 에디터
카드 아래  (960, 179) -> Claude
D0 옛 죽은영역 (660,60)/(1260,60)/(960,220) -> 전부 하위 창
```

## Consequences

### 대가: 드롭섀도가 잘린다

창 밖으로 번지는 `box-shadow` 는 렌더링되지 않는다. 그림자를 살리려면 그만큼 여백이
필요하고, **그 여백이 그대로 죽은 영역**이라 맞바꿀 수 없다.
입체감은 테두리 + 안쪽 하이라이트(`inset`)로 대체했다.

이건 「알려진 한계 7」로 남는다. 되살리려면 A 로 가야 하고, 그때 폴링 비용을 다시 계산한다.

### 카드 CSS 에 제약이 생겼다

- **바깥 여백(margin)·드롭섀도 금지.** 창 밖이라 잘리고, 여백은 죽은 영역이 된다
- `.overlay-root` 의 `padding-top` 도 같은 이유로 제거했다.
  화면 상단에서 띄우고 싶으면 `TOP_GAP` 상수로 창 위치를 내린다 (기본 0)

### 표시가 먼저, 측정이 나중

`fitWindow` 는 `show_overlay_noactivate` → rAF → `getBoundingClientRect()` → `setSize` 순서다.

**숨겨진 WebView2 는 레이아웃을 돌리지 않아서 `getBoundingClientRect()` 가 전부 0으로 나온다.**
처음엔 측정 후 표시로 짰다가 "카드는 발화했는데 창이 안 뜨는" 증상을 만들었다.
이 시점 카드는 `translateY(-100%) / opacity:0` 이라 창을 먼저 띄워도 화면에는 안 보인다.

측정에 실패해도 카드는 떠야 하므로 `tauri.conf.json` 의 기본 크기로 폴백하고 경고를 남긴다
(죽은 영역은 남지만 알림을 놓치는 것보다 낫다).

### capabilities 를 건드려야 했다

`core:window:allow-set-size`, `core:window:allow-scale-factor` 가 없어서 처음엔
`window.set_size not allowed` 로 조용히 실패했다. `fitWindow` 에 실패 로그를 달아둔 덕에
한 번에 원인이 나왔다 — 새 창 API 를 쓸 때는 `src-tauri/capabilities/default.json` 을 같이 볼 것.
