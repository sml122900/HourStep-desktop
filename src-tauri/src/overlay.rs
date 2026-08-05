//! 오버레이 창 표시/숨김. Phase D0 스파이크의 핵심.
//!
//! 요구사항: 프레임리스 + always-on-top + skipTaskbar + 투명 배경이며,
//! **뜨는 순간 뒤 작업 창의 포커스를 뺏지 않아야 한다.**
//!
//! Tauri의 `WebviewWindow::show()` 는 Windows에서 `ShowWindow(SW_SHOW)` 를 부르는데,
//! 이건 창을 활성화(activate)하면서 포그라운드 포커스를 가져간다. 그래서 Windows에서는
//! Win32를 직접 불러 `SW_SHOWNOACTIVATE` 로 띄우고, `SetWindowPos` 에 `SWP_NOACTIVATE` 를
//! 준다. 추가로 매번 `HWND_TOPMOST` 를 다시 걸어 브라우저 전체화면 등 다른 topmost 창
//! 위로 올라오게 한다.

use tauri::{AppHandle, Manager};

pub const OVERLAY_LABEL: &str = "overlay";

/// `WS_EX_NOACTIVATE` 를 붙이면 오버레이 카드를 **클릭해도** 포커스가 넘어오지 않는다.
/// (마우스 이벤트는 정상 전달되지만 키보드 포커스는 뒤 창에 남는다.)
/// 만약 특정 환경에서 버튼 클릭이 먹지 않으면 이 값을 false 로 바꿔 확인할 것 — D0 스파이크의 관찰 포인트.
#[cfg(windows)]
const KEEP_FOCUS_ON_CLICK: bool = true;

/// 트레이/메인 창에서 오버레이 표시를 요청한다. 실제 위치 계산과 애니메이션은 프론트엔드가 담당.
pub fn trigger(app: &AppHandle) {
    use tauri::Emitter;

    if app.get_webview_window(OVERLAY_LABEL).is_none() {
        eprintln!("[overlay] '{OVERLAY_LABEL}' 창이 없습니다");
        return;
    }
    println!("[overlay] show 요청");
    if let Err(e) = app.emit_to(OVERLAY_LABEL, "overlay://show", ()) {
        eprintln!("[overlay] show 이벤트 전송 실패: {e}");
    }
}

#[tauri::command]
pub fn show_overlay_noactivate(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or_else(|| format!("'{OVERLAY_LABEL}' 창을 찾을 수 없습니다"))?;

    // 다른 always-on-top 창(전체화면 브라우저 등)보다 뒤로 밀리지 않도록 매번 재설정
    window.set_always_on_top(true).map_err(|e| e.to_string())?;

    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE,
            HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_SHOWNOACTIVATE,
            WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        };

        let raw = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd: HWND = raw.0 as isize as HWND;

        unsafe {
            let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            // 작업표시줄 + Alt+Tab 목록에서 제외 (skipTaskbar 설정만으로는 Alt+Tab 이 남는다)
            ex |= WS_EX_TOOLWINDOW as isize;
            ex &= !(WS_EX_APPWINDOW as isize);
            if KEEP_FOCUS_ON_CLICK {
                ex |= WS_EX_NOACTIVATE as isize;
            }
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);

            SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
    }

    #[cfg(not(windows))]
    {
        window.show().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or_else(|| format!("'{OVERLAY_LABEL}' 창을 찾을 수 없습니다"))?;
    println!("[overlay] hide");

    // show 를 raw Win32 로 하기 때문에 hide 도 반드시 raw 로 대칭 처리해야 한다.
    // tao 의 `WebviewWindow::hide()` 는 내부 WindowFlags::VISIBLE 캐시를 보고 diff 를 적용하는데,
    // ShowWindow 를 직접 부르면 그 캐시가 갱신되지 않아 hide() 가 no-op 이 된다.
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

        let raw = window.hwnd().map_err(|e| e.to_string())?;
        let hwnd: HWND = raw.0 as isize as HWND;
        unsafe {
            ShowWindow(hwnd, SW_HIDE);
        }
    }

    #[cfg(not(windows))]
    {
        window.hide().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 오버레이 버튼 액션을 Rust stdout 에도 남긴다 (D0 검증 시 `pnpm tauri dev` 터미널에서 확인).
#[tauri::command]
pub fn log_overlay_action(action: String) {
    println!("[overlay] action = {action}");
}

/// 오버레이의 실제 표시 여부.
///
/// `WebviewWindow::is_visible()` 을 쓰면 안 된다 — show/hide 를 raw Win32 로 하기 때문에
/// tao 의 `WindowFlags::VISIBLE` 캐시가 갱신되지 않아 항상 "숨김"으로 답한다.
/// (docs/decisions/0001)
///
/// 현재 호출부는 `--debug-cmd dump` 뿐이라 릴리스 빌드에서는 dead code 가 된다.
#[cfg_attr(not(debug_assertions), allow(dead_code))]
pub fn is_visible(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return false;
    };

    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::IsWindowVisible;

        match window.hwnd() {
            Ok(raw) => {
                let hwnd: HWND = raw.0 as isize as HWND;
                unsafe { IsWindowVisible(hwnd) != 0 }
            }
            Err(_) => false,
        }
    }

    #[cfg(not(windows))]
    {
        window.is_visible().unwrap_or(false)
    }
}
