//! 트레이 아이콘 + 메뉴. 앱의 상주 진입점.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle,
};

use crate::overlay;
use crate::windows::{show_settings_window, show_window};

const ID_START_SESSION: &str = "start_session";
const ID_TEST_NOTIFICATION: &str = "test_notification";
const ID_SETTINGS: &str = "settings";
const ID_QUIT: &str = "quit";

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let start = MenuItem::with_id(app, ID_START_SESSION, "▶ 작업 시작", true, None::<&str>)?;
    let test = MenuItem::with_id(app, ID_TEST_NOTIFICATION, "테스트 알림", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, ID_SETTINGS, "설정", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "종료", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&start, &test, &settings, &sep, &quit])?;

    TrayIconBuilder::with_id("hourstep-tray")
        .icon(
            app.default_window_icon()
                .expect("기본 창 아이콘이 없습니다")
                .clone(),
        )
        .tooltip("HourStep — 작업 중 휴식 리마인더")
        .menu(&menu)
        // Windows 관례: 좌클릭은 창 열기, 우클릭은 메뉴
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle(), "main");
            }
        })
        .build(app)?;

    Ok(())
}

/// D0 placeholder — 실제 세션 시작은 D1 범위.
/// `--debug-cmd start-session` 이 이 함수를 그대로 호출하므로 자동 검증과 트레이 동작이 어긋나지 않는다.
pub fn start_session_placeholder() {
    println!("[tray] 작업 시작 (placeholder — D1에서 구현)");
}

fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        ID_START_SESSION => start_session_placeholder(),
        ID_TEST_NOTIFICATION => {
            println!("[tray] 테스트 알림 트리거");
            overlay::trigger(app);
        }
        ID_SETTINGS => show_settings_window(app),
        ID_QUIT => {
            println!("[tray] 종료");
            app.exit(0);
        }
        other => eprintln!("[tray] 알 수 없는 메뉴 항목: {other}"),
    }
}
