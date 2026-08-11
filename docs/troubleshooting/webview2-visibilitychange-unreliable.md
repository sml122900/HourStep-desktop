# WebView2 는 `window.hide()` 로 숨겨도 `visibilitychange` 를 신뢰할 수 없다

- 날짜: 2026-08-11
- 관련: `docs/decisions/0013-main-hidden-signal-not-page-visibility.md`,
  `docs/decisions/0001-overlay-show-hide-win32.md`, `src-tauri/src/windows.rs`,
  `src/windows/main/MainWindow.tsx`

## 문제 상황

메인 창을 처음 숨길 때(창 닫기 X, 또는 [백그라운드에서 실행] 버튼) 시스템 토스트로
한 번만 안내하는 기능을 짜면서, "창이 막 숨겨졌다"를 표준적인 방법 —
`document.hidden`/`visibilitychange` — 로 판단하게 했다. 코드는 이랬다.

```ts
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || flag.alreadyShown) return
  // 토스트 띄우고 플래그 저장
})
```

`--debug-cmd main-hide` 로 자동 검증했는데 **아무 로그도 안 찍혔다.** 대기 시간을
1초 → 5초로 늘려도 마찬가지였다. 코드가 안 불린 건지, 조건문이 틀린 건지부터
의심스러웠다.

## 시도한 것들

| 시도 | 결과 |
| --- | --- |
| `wait` 을 1초 → 5초로 늘려서 재시도 | 여전히 로그 없음. 타이밍 문제가 아니다 |
| `main-hide` 뒤 `db-dump` 로 실제 창 상태 확인 | (간접 확인) 창 자체는 정상적으로 숨겨진다 — `hide_main` 은 `window.hide()` 를 실제로 호출하고 있었다 |
| 리스너 안에 **무조건** 찍히는 진단 로그 추가 (`DIAG visibilitychange hidden=…`) 후 재실행 | **5초 넘게 한 줄도 안 찍힘** — `visibilitychange` 이벤트 자체가 안 온다는 뜻. 조건문·플래그 문제가 아니라 이벤트가 발화하지 않는 것으로 좁혀졌다 |

세 번째가 결정적이었다. "조건이 틀렸다"와 "이벤트가 아예 안 온다"는 완전히 다른
문제인데, 무조건 로그를 하나 심어 그 둘을 갈랐다.

## 최종 해결법

**원인**: WebView2 는 창이 `ShowWindow(SW_HIDE)`(Tauri 의 공식 `window.hide()`) 로
숨겨져도 Chromium 의 Page Visibility 상태 전환을 신뢰성 있게 보내지 않는다.
브라우저 탭 전환·최소화 같은 표준 경로에서는 동작하지만, 이 앱처럼 프레임리스 창을
프로그램적으로 숨기는 경로에서는 실측 결과 오지 않았다.

기존 코드(D2.5)에 이미 `document.hidden` 을 쓰는 자리가 있었다 — 메인 창의 tick 렌더
스킵(`if (!document.hidden) setNow(...)`). 이게 지금까지 안 걸린 이유는 **틀려도 표가
안 나는 자리**였기 때문이다. 숨은 창이 매초 계속 다시 그려도(스킵이 작동 안 해도)
성능 낭비일 뿐 아무도 못 알아챈다. 이번엔 "숨었다는 사실 자체"가 로직을 좌우하는
자리(1회성 안내)라 그 자리에서 처음으로 증상이 드러났다.

**해결**: Page Visibility 를 아예 믿지 않는다. Rust 가 창을 숨기는 그 시점에
**명시적으로 이벤트를 쏜다.**

```rust
// src-tauri/src/windows.rs
pub fn hide_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.hide();
        let _ = window.emit(MAIN_HIDDEN_EVENT, ()); // "main://hidden"
    }
}
```

X 닫기(`CloseRequested`)와 [백그라운드에서 실행] 버튼을 이 함수 하나로 모아서
어느 경로로 숨어도 같은 이벤트가 나가게 했다. `--debug-cmd main-hide` 도 이 함수를
타도록 바꿔서, 검증 경로와 실제 경로가 갈라지지 않게 했다(CLAUDE.md 「검증 정책」).

근거·설계는 `docs/decisions/0013` 에 정리했다.

## 재발 방지

- `CLAUDE.md` 「역할 분담」 절에 경고 문단 추가: `document.hidden`/`visibilitychange` 는
  "안 보인다"의 신뢰할 근거가 못 될 때가 있다 — 로직을 좌우하는 자리라면 Rust 가 명시적
  이벤트를 쏘게 할 것
- 오버레이의 `is_visible()` 우회(`docs/decisions/0001`)와 같은 항목으로 묶어서, "이 앱은
  창 표시/숨김 상태를 프레임워크 표준 API 로 신뢰하면 안 된다"는 하나의 패턴으로 남겼다

## 이력서 소재 한 줄

> WebView2 가 `window.hide()` 로 숨긴 창의 Page Visibility 전환을 신뢰성 있게 보내지
> 않는 것을, "무조건 찍히는 진단 로그"로 "조건 오류"와 "이벤트 미발화"를 분리해 확인하고,
> 프레임워크 이벤트 대신 네이티브 계층이 명시적 신호를 보내는 구조로 재설계해 해결
