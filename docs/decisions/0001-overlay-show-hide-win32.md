# 0001. 오버레이 표시/숨김은 Win32 API를 직접 호출한다

- 날짜: 2026-08-05
- Phase: D0
- 상태: 채택

## 맥락

오버레이 카드는 사용자가 다른 앱에서 작업하는 도중에 뜬다.
이때 **포커스를 뺏으면 타이핑이 끊기고**, 제품이 "방해하는 알림"이 되어 버린다.
CLAUDE.md 결정 3의 "무시하기 어렵되 작업은 파괴하지 않는다"와 정면으로 충돌한다.

Tauri v2의 `WebviewWindow::show()` 는 Windows에서 `ShowWindow(SW_SHOW)` 를 호출하는데,
이는 창을 활성화(activate)하면서 포그라운드 포커스를 가져간다.
`tauri.conf.json` 의 `focus: false` 는 **창 생성 시점**에만 적용되고 이후 `show()` 에는 영향이 없다.

## 결정

오버레이 창의 표시/숨김만 `windows-sys` 로 Win32를 직접 호출한다.
(`src-tauri/src/overlay.rs`)

**표시** — `show_overlay_noactivate`
| 호출 | 목적 |
| --- | --- |
| `SetWindowLongPtrW(GWL_EXSTYLE, ... \| WS_EX_NOACTIVATE)` | 카드를 **클릭해도** 포커스가 넘어오지 않음 |
| `... \| WS_EX_TOOLWINDOW`, `... & !WS_EX_APPWINDOW` | 작업표시줄 + **Alt+Tab** 목록에서 제외 |
| `SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE)` | 매번 topmost 재확보 (전체화면 브라우저 위로) |
| `ShowWindow(SW_SHOWNOACTIVATE)` | 활성화 없이 표시 |

**숨김** — `hide_overlay`: `ShowWindow(SW_HIDE)`

## 왜 hide도 raw여야 하는가

tao는 `WindowFlags::VISIBLE` 캐시를 두고 상태 diff만 Win32에 적용한다.
`ShowWindow` 를 직접 부르면 이 캐시가 갱신되지 않아, 이어지는 `window.hide()` 가
"이미 숨김"으로 판단하고 **no-op** 이 된다.

D0 구현 중 실제로 이 버그를 밟았다. 카드 DOM은 언마운트되는데 창은 남아서
화면 상단에 **보이지 않는 클릭 차단 사각형**이 생겼다.

→ show/hide 양쪽 모두 tao를 우회해 상태를 일관되게 유지한다.
한쪽만 우회하면 프레임워크 캐시와 실제 창 상태가 갈라진다.

## 트레이드오프

`WS_EX_NOACTIVATE` 는 키보드 포커스도 막는다. 따라서 카드 버튼을 **Tab/Enter로 조작할 수 없다.**
마우스 클릭은 정상 동작한다 (D0에서 실측 확인).

포커스 유지가 제품 정체성에 더 가깝다고 보고 이쪽을 택했다.
접근성이 필요해지면 전역 단축키(예: `Ctrl+Alt+1/2/3`)로 푸는 편이 맞다.

뒤집을 수 있게 `overlay.rs` 상단에 `KEEP_FOCUS_ON_CLICK: bool` 상수를 두었다.

## 대안 검토

| 대안 | 기각 사유 |
| --- | --- |
| `focus: false` 설정만 사용 | 창 생성 시점에만 적용, `show()` 에는 무효 |
| `show()` 후 이전 창에 `SetForegroundWindow` 로 포커스 반환 | 포커스가 한 번 튀는 게 눈에 보이고, Windows의 포그라운드 잠금 규칙 때문에 실패할 수 있음 |
| 오버레이를 메인 창 내부 요소로 구현 | 다른 앱 위에 뜰 수 없음 — 제품 요구사항 미충족 |
| Electron | 상주 앱 메모리 (Tauri 32MB vs Electron ~150MB). CLAUDE.md 결정 1 |

## 영향

- Windows 전용 코드가 `overlay.rs` 에 생김. `#[cfg(windows)]` / `#[cfg(not(windows))]` 로 분기하고
  비-Windows에서는 평범한 `show()` / `hide()` 로 폴백한다 (macOS 포팅 시 `NSWindow` 레벨 조정 필요)
- 오버레이 창에는 **절대 `window.show()` / `window.hide()` 를 직접 쓰면 안 된다.**
  반드시 `show_overlay_noactivate` / `hide_overlay` 커맨드를 경유할 것
