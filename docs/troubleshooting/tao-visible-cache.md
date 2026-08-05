# tao 의 visible 캐시 — `hide()` 가 조용히 아무 일도 안 한다

- 날짜: 2026-08-05 (Phase D0)
- 관련: `docs/decisions/0001-overlay-show-hide-win32.md`

## 문제 상황

오버레이 카드의 `[✅ 완료]` 버튼을 누르면:
- 로그는 정상 (`[overlay] action = done` → `[overlay] hide`)
- 카드 DOM 도 정상적으로 언마운트됨
- **그런데 창이 안 사라진다**

카드 내용만 사라지고 창은 남아서, 화면 상단 중앙에
**눈에 보이지 않는 640×240 클릭 차단 사각형**이 생겼다.
투명한 데다 아무것도 안 그려져 있으니 화면상으로는 정상인데,
그 영역에서 뒤에 있는 브라우저를 클릭하면 반응이 없다.

증상이 고약했던 이유:
1. 눈에 안 보인다 — "창이 남아 있다"는 발상 자체를 하기 어렵다
2. 로그는 전부 정상이라 코드 흐름을 의심하게 된다
3. 심지어 **버그를 다른 버그로 오진**했다.
   자동 실행 로그에 클릭한 적 없는 `action = done` 이 계속 찍혀서
   합성 클릭 이벤트를 의심하고 `isTrusted` 계측까지 붙였다.
   실제로는 **사람이 화면에 뜬 카드를 누른 것**이었고,
   hide 가 안 되니 카드가 그대로 남아 "안 눌렀는데 로그가 찍힌다"로 보였을 뿐이다

## 시도한 것들

| 시도 | 결과 |
| --- | --- |
| 프론트엔드 `dismiss()` 흐름 추적 | 정상. `invoke('hide_overlay')` 까지 도달 |
| Rust `hide_overlay` 에 `println!` 추가 | `[overlay] hide` 는 찍힘 → 커맨드는 호출됨 |
| `window.hide()` 반환값 확인 | `Ok(())` — 에러 아님 |
| 권한(capability) 의심 | Rust 에서 직접 호출이라 무관 |
| React StrictMode 이중 리스너 의심 | 무관. `dismiss` 는 onClick 에서만 호출됨 |
| 사람 개입 없는 조건에서 재현 | 유령 클릭이 사라짐 → **"클릭 로그"와 "hide 실패"는 별개 문제**임이 드러남 |

마지막 단계가 결정적이었다. 사람이 만질 수 없는 조건(자동 트리거)에서 돌리니
`action` 로그가 아예 안 찍혔고, 그제서야 "hide 가 no-op"이라는 단일 문제로 좁혀졌다.

## 최종 해결법

**원인**: tao(Tauri 의 창 백엔드)는 `WindowFlags::VISIBLE` 캐시를 두고
**상태 diff 만** Win32 에 적용한다.

오버레이는 포커스를 뺏지 않으려고 `ShowWindow(SW_SHOWNOACTIVATE)` 를 **직접** 호출한다.
이때 tao 의 캐시는 갱신되지 않아 여전히 "숨김"이라고 알고 있다.
그 상태에서 `window.hide()` 를 부르면:

```
캐시: VISIBLE=false  →  요청: VISIBLE=false  →  diff 없음  →  ShowWindow 호출 안 함  →  Ok(())
```

에러도 안 나고 조용히 아무 일도 안 한다.

**해결**: show 를 raw Win32 로 했으면 **hide 도 대칭으로 raw** 여야 한다.

```rust
// src-tauri/src/overlay.rs
#[cfg(windows)]
{
    let hwnd: HWND = window.hwnd()?.0 as isize as HWND;
    unsafe { ShowWindow(hwnd, SW_HIDE); }
}
```

양쪽 모두 tao 를 우회하므로 캐시와 실제 창 상태가 갈라지지 않는다.

### 같은 뿌리에서 한 번 더 밟을 뻔했다

이후 `--debug-cmd dump` 를 만들면서 `WebviewWindow::is_visible()` 을 쓰려 했는데,
같은 이유로 **오버레이에 대해서는 항상 `false`** 를 반환한다.
Win32 `IsWindowVisible` 을 직접 부르는 `overlay::is_visible()` 을 따로 만들었다.

→ **교훈: 프레임워크의 상태 캐시를 우회할 거면, 그 상태를 읽는 경로도 전부 우회해야 한다.**
쓰기만 우회하고 읽기를 그대로 두면 다음 사람(=미래의 나)이 똑같이 속는다.

## 재발 방지

- `docs/decisions/0001` 에 "오버레이 창에 `window.show()`/`hide()`/`is_visible()` 직접 호출 금지" 명시
- CLAUDE.md 개발 메모에 같은 내용 기재
- `--debug-cmd dump` 로 오버레이 표시 여부를 자동 검증 가능하게 만듦

## 이력서 소재 한 줄

> 프레임워크(tao)의 창 상태 캐시를 우회하는 네이티브 호출 때문에 `hide()` 가 조용히 무효화되어
> 화면에 보이지 않는 클릭 차단 영역이 남는 버그를, 사람 개입 없는 재현 조건을 만들어
> 증상 두 개(유령 클릭 로그 / 창 미소멸)를 분리해 진단하고 show·hide 대칭 처리로 해결
