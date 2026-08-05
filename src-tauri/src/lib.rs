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
            // 오버레이가 주기적으로 떴다 사라진다. 전체화면 앱(C 항목)처럼 트레이를 누를 수 없는
            // 상황에서 카드를 띄우기 위한 것 — 그래서 1회성이 아니라 반복이어야 한다.
            #[cfg(debug_assertions)]
            if std::env::var("HOURSTEP_SPIKE_AUTO_OVERLAY").is_ok() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    use std::time::Duration;

                    /// 첫 표시까지 — 전체화면에 진입할 여유
                    const FIRST_DELAY: Duration = Duration::from_secs(8);
                    /// 카드가 떠 있는 시간
                    const VISIBLE: Duration = Duration::from_secs(8);
                    /// 다음 표시까지 쉬는 시간 (주기 = VISIBLE + IDLE)
                    const IDLE: Duration = Duration::from_secs(12);

                    println!(
                        "[spike] 자동 오버레이 모드 — {}초 뒤 첫 표시, 이후 {}초 표시 / {}초 대기 반복",
                        FIRST_DELAY.as_secs(),
                        VISIBLE.as_secs(),
                        IDLE.as_secs()
                    );
                    std::thread::sleep(FIRST_DELAY);

                    loop {
                        overlay::trigger(&handle);
                        std::thread::sleep(VISIBLE);
                        if let Err(e) = overlay::hide_overlay(handle.clone()) {
                            eprintln!("[spike] hide 실패: {e}");
                        }
                        std::thread::sleep(IDLE);
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
