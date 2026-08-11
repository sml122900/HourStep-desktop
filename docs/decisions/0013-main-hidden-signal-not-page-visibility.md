# 0013. 창이 숨겨졌다는 판단은 Page Visibility 가 아니라 Rust 의 명시적 이벤트로

- 날짜: 2026-08-11
- Phase: D2.8 후속
- 상태: 채택
- 관련: `src-tauri/src/windows.rs`, `src/windows/main/MainWindow.tsx`,
  `docs/troubleshooting/webview2-visibilitychange-unreliable.md`,
  `docs/decisions/0001-overlay-show-hide-win32.md`,
  `docs/decisions/0004-rust-clock-ts-judgment.md`

## Problem

메인 창을 처음 숨길 때(닫기 X, [백그라운드에서 실행] 버튼) 시스템 토스트로 한 번만
안내하려면, "창이 방금 숨겨졌다"를 웹뷰의 JS 가 알아야 한다. 표준적인 방법은
Page Visibility API(`document.hidden`/`visibilitychange`) 다 — 이 앱도 D2.5 부터
tick 렌더 스킵에 이미 쓰고 있었다.

실측 결과 WebView2 는 Tauri 의 공식 `window.hide()`(`ShowWindow(SW_HIDE)`) 로 숨긴
창에서 `visibilitychange` 를 5초 넘게 주지 않았다(진단 기록:
`docs/troubleshooting/webview2-visibilitychange-unreliable.md`). 기존 tick 스킵
코드가 이 문제를 겪지 않은 건 **틀려도 표가 안 나는 자리**였기 때문이다 — 숨은 창이
계속 다시 그려도 낭비일 뿐 아무도 못 알아챈다. 1회성 안내처럼 "숨었다는 사실"이
로직을 좌우하는 자리에서 처음으로 증상이 드러났다.

## Decision

**Page Visibility 를 신뢰하지 않는다. Rust 가 창을 숨기는 바로 그 지점에서 명시적으로
이벤트를 쏜다.**

```rust
// src-tauri/src/windows.rs
pub const MAIN_HIDDEN_EVENT: &str = "main://hidden";

pub fn hide_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.hide();
        let _ = window.emit(MAIN_HIDDEN_EVENT, ());
    }
}
```

메인 창을 숨기는 두 경로(X 닫기의 `CloseRequested`, [백그라운드에서 실행] 버튼의
`hide_main_window` 커맨드) 를 이 함수 하나로 모았다 — 어느 쪽으로 숨어도 같은
이벤트가 나간다. `--debug-cmd main-hide` 도 직접 `window.hide()` 를 부르던 것에서
이 함수를 타도록 바꿨다 — 검증 경로가 실제 경로와 갈라지면 검증이 의미를 잃는다
(CLAUDE.md 「검증 정책」).

TS 쪽은 여전히 **판단**만 한다 — 플래그를 보고 알림을 띄울지, 권한을 요청할지는
`MainWindow.tsx` 가 정한다. Rust 는 "숨었다는 사실"만 보증한다. 이건
「시계는 Rust, 판단은 TS」(`0004`) 와 같은 갈래다 — 거기서는 "지금이 언제인가"를
Rust 가 보증했고, 여기서는 "창이 지금 어떤 상태인가"를 Rust 가 보증한다.

## Consequences

- **Page Visibility 를 신뢰 신호로 쓰던 다른 자리(tick 렌더 스킵)는 그대로 뒀다.**
  거기는 틀려도 성능 낭비일 뿐이라 지금 당장 고칠 이유가 없다. 대신 `CLAUDE.md` 에
  경고를 남겨서, **로직을 좌우하는 새 자리**가 생기면 같은 함정을 밟지 않게 했다
- 오버레이가 `WebviewWindow::is_visible()`/`show()`/`hide()` 를 직접 쓰지 않는 이유
  (`0001`)와 뿌리가 같다 — "이 앱은 창 표시 상태를 프레임워크 표준 API 로 신뢰하면
  안 된다"는 하나의 패턴으로 묶인다. 다만 원인은 다르다: `0001` 은 tao 의 내부 캐시가
  raw Win32 호출과 어긋나는 문제였고, 이번엔 WebView2 의 Page Visibility 구현 자체가
  이 앱의 창 숨김 경로를 감지하지 못하는 문제다
- 검증(2026-08-11, `--debug-cmd`, 실 DB 대상): 첫 `main-hide` → 안내 로그 1회,
  같은 프로세스 안 두 번째 `main-hide` → 로그 없음, 프로세스를 새로 띄운 뒤에도
  로그 없음(플래그가 재시작을 넘어 지속). `db-dump` 전후 세션·기록 수 동일 —
  세션·기록은 만들지 않았다
