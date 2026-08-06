//! 일반 창(메인/설정) 표시·숨김 헬퍼.
//!
//! 규칙(CLAUDE.md): 메인 창 닫기 = 트레이로 숨김. 앱 종료는 트레이 메뉴에서만.

use tauri::{AppHandle, Manager};

pub const MAIN_LABEL: &str = "main";
pub const SETTINGS_LABEL: &str = "settings";

pub fn show_window(app: &AppHandle, label: &str) {
    let Some(window) = app.get_webview_window(label) else {
        eprintln!("[windows] '{label}' 창을 찾을 수 없습니다");
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub fn show_settings_window(app: &AppHandle) {
    show_window(app, SETTINGS_LABEL);
}

#[tauri::command]
pub fn hide_main_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.hide();
    }
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle) {
    show_settings_window(&app);
}

/// 메인 창의 "테스트 알림 띄우기" — 트레이 메뉴와 같은 경로.
#[tauri::command]
pub fn trigger_test_overlay(app: AppHandle) {
    println!("[main] 테스트 알림 트리거");
    crate::overlay::trigger(&app, crate::overlay::TEST_BEHAVIOR_ID);
}
