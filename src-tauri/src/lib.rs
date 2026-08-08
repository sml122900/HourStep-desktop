mod db;
#[cfg(debug_assertions)]
mod debug_cmd;
mod overlay;
mod session;
mod tray;
mod windows;

use std::sync::Mutex;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

/// 부팅 자동 실행으로 켜졌을 때 붙는 인자. 이 경우 창을 띄우지 않고 트레이로만 조용히 시작한다.
const AUTOSTART_FLAG: &str = "--autostart";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance 는 반드시 첫 번째로 등록해야 한다 (플러그인 문서).
        // 자동실행본이 이미 떠 있는데 사용자가 또 실행하면 알림이 2배로 뜨는 걸 막는다.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            println!("[app] 두 번째 인스턴스 감지 — 기존 창을 띄운다");
            windows::show_window(app, windows::MAIN_LABEL);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DB_URL, db::migrations())
                .build(),
        )
        .manage(session::SessionState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            overlay::show_overlay_noactivate,
            overlay::hide_overlay,
            overlay::log_overlay_action,
            session::current_session,
            session::end_session_command,
            session::log_completion,
            session::log_debug,
            session::start_session_command,
            windows::hide_main_window,
            windows::open_settings_window,
            windows::trigger_test_overlay,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 오버레이는 스스로 숨으므로 관여하지 않는다.
                if window.label() == overlay::OVERLAY_LABEL {
                    return;
                }
                // 창을 닫아도 앱은 살아있고 트레이로 숨는다. 종료는 트레이 메뉴에서만.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            tray::build(app.handle())?;
            session::spawn_tick(app.handle());

            let launched_by_autostart = std::env::args().any(|arg| arg == AUTOSTART_FLAG);
            if launched_by_autostart {
                println!("[app] 부팅 자동 실행 — 창 없이 트레이로 시작");
            } else if let Some(main) = app.get_webview_window(windows::MAIN_LABEL) {
                let _ = main.show();
                let _ = main.set_focus();
            }

            // 자동 검증용 디버그 훅 (개발 빌드 전용).
            // 합성 입력 주입 없이 트레이/클릭 시나리오를 검증하기 위한 경로 — CLAUDE.md 「검증 정책」
            #[cfg(debug_assertions)]
            if let Some(script) = debug_cmd::script_from_args() {
                debug_cmd::spawn(app.handle(), script);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
