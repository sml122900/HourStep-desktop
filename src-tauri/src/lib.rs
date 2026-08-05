mod overlay;
mod tray;
mod windows;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

/// 부팅 자동 실행으로 켜졌을 때 붙는 인자. 이 경우 창을 띄우지 않고 트레이로만 조용히 시작한다.
const AUTOSTART_FLAG: &str = "--autostart";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        .invoke_handler(tauri::generate_handler![
            overlay::show_overlay_noactivate,
            overlay::hide_overlay,
            overlay::log_overlay_action,
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

            let launched_by_autostart = std::env::args().any(|arg| arg == AUTOSTART_FLAG);
            if launched_by_autostart {
                println!("[app] 부팅 자동 실행 — 창 없이 트레이로 시작");
            } else if let Some(main) = app.get_webview_window(windows::MAIN_LABEL) {
                let _ = main.show();
                let _ = main.set_focus();
            }

            // D0 스파이크 자동 검증용 스모크 경로.
            // 개발 빌드에서 HOURSTEP_SPIKE_AUTO_OVERLAY=1 이면 사람이 트레이를 클릭하지 않아도
            // 4초 뒤 오버레이를 띄우고 8초 뒤 숨긴다. 창 스타일/좌표/포커스를 외부에서 검사하기 위한 것.
            #[cfg(debug_assertions)]
            if std::env::var("HOURSTEP_SPIKE_AUTO_OVERLAY").is_ok() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(4));
                    overlay::trigger(&handle);
                    std::thread::sleep(std::time::Duration::from_secs(8));
                    if let Err(e) = overlay::hide_overlay(handle.clone()) {
                        eprintln!("[spike] hide 실패: {e}");
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
