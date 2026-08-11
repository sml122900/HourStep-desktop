//! 일반 창(메인/설정) 표시·숨김 헬퍼.
//!
//! 규칙(CLAUDE.md): 메인 창 닫기 = 트레이로 숨김. 앱 종료는 트레이 메뉴에서만.

use tauri::{AppHandle, Emitter, Manager};

pub const MAIN_LABEL: &str = "main";
pub const SETTINGS_LABEL: &str = "settings";

/// 메인 창이 방금 숨겨졌다는 신호. WebView2 는 `ShowWindow(SW_HIDE)` 로 숨겨도
/// `document.hidden`/`visibilitychange` 를 신뢰성 있게 주지 않아서(실측 확인),
/// "숨었다"는 판단 자체를 Rust 가 알려주고 TS 는 무엇을 할지만 정한다 (docs/decisions/0004 와 같은 결).
pub const MAIN_HIDDEN_EVENT: &str = "main://hidden";

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
    hide_main(&app);
}

/// 메인 창 숨김의 단일 경로 — X 닫기(`CloseRequested`)와 헤더의 [백그라운드에서 실행]
/// 버튼이 여기로 모인다.
pub fn hide_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        let _ = window.hide();
        let _ = window.emit(MAIN_HIDDEN_EVENT, ());
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

/// 오버레이 카드의 [자세히] — 메인 창을 띄우고 어떤 동작을 펼칠지 알려준다 (D2.9).
/// 상세 내용(방법·시간·출처)은 Rust 가 모른다 — `src/constants/strings.ts` 의
/// `ACTION_CARDS` 가 단일 출처이고, 여기서는 "무엇을 보여줄지"만 실어 나른다.
#[tauri::command]
pub fn show_action_detail(app: AppHandle, action_id: String) {
    show_window(&app, MAIN_LABEL);
    let _ = app.emit_to(MAIN_LABEL, "main://action-detail", action_id);
}
