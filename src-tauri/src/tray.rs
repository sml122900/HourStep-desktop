//! 트레이 아이콘 + 메뉴. 앱의 상주 진입점.

use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};

use crate::overlay;
use crate::session;
use crate::windows::{show_settings_window, show_window};

const ID_SESSION: &str = "session_toggle";
const ID_TEST_NOTIFICATION: &str = "test_notification";
const ID_SETTINGS: &str = "settings";
const ID_QUIT: &str = "quit";

const LABEL_START: &str = "▶ 작업 시작";
const LABEL_END: &str = "■ 작업 종료";

/// 세션 토글 메뉴 항목. 라벨을 바꾸려면 핸들을 들고 있어야 한다.
struct SessionMenuItem(Mutex<MenuItem<Wry>>);

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let session_item = MenuItem::with_id(app, ID_SESSION, LABEL_START, true, None::<&str>)?;
    let test = MenuItem::with_id(app, ID_TEST_NOTIFICATION, "테스트 알림", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, ID_SETTINGS, "설정", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, ID_QUIT, "종료", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&session_item, &test, &settings, &sep, &quit])?;
    app.manage(SessionMenuItem(Mutex::new(session_item)));

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

/// 세션 상태에 맞춰 토글 항목 라벨을 바꾼다. `session` 모듈이 부른다.
pub fn set_session_active(app: &AppHandle, active: bool) {
    let label = if active { LABEL_END } else { LABEL_START };
    if let Some(item) = app.try_state::<SessionMenuItem>() {
        if let Ok(guard) = item.0.lock() {
            let _ = guard.set_text(label);
        }
    }
}

fn on_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        ID_SESSION => {
            session::toggle(app);
        }
        ID_TEST_NOTIFICATION => {
            println!("[tray] 테스트 알림 트리거");
            overlay::trigger(app, overlay::TEST_BEHAVIOR_ID);
        }
        ID_SETTINGS => show_settings_window(app),
        ID_QUIT => {
            println!("[tray] 종료");
            app.exit(0);
        }
        other => eprintln!("[tray] 알 수 없는 메뉴 항목: {other}"),
    }
}
