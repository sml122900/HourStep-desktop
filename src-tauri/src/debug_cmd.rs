//! `--debug-cmd` 디버그 훅 (개발 빌드 전용).
//!
//! CLAUDE.md 「검증 정책」: 사용자 데스크톱에 합성 입력을 주입하지 않고 자동 검증하기 위한 경로다.
//! 트레이 클릭이나 마우스 클릭이 필요한 시나리오를 **같은 핸들러를 직접 호출**해서 대체한다.
//!
//! ```powershell
//! # 트레이 [작업 시작] 이 콘솔 로그만 찍는지 (F-1)
//! pnpm tauri dev -- -- --debug-cmd "wait:3000,dump,start-session,wait:1500,dump,quit"
//!
//! # 오버레이 표시 → 완료 액션 → 숨김 (B-4 의 액션 체인)
//! pnpm tauri dev -- -- --debug-cmd "wait:3000,overlay-show,wait:2000,overlay-action:done,wait:1500,dump,quit"
//!
//! # 전체화면 테스트용 반복 표시 (C 항목)
//! pnpm tauri dev -- -- --debug-cmd "wait:8000,overlay-show,wait:8000,overlay-hide,wait:12000,loop"
//! ```
//!
//! 한계: 이 훅은 **자기 프로세스 안에서만** 동작한다. 이미 떠 있는 다른 인스턴스에는 명령을
//! 보낼 수 없다 (그러려면 single-instance 플러그인 + argv 전달이 필요 — D3 범위).
//! 또한 "실제 마우스 클릭이 `WS_EX_NOACTIVATE` 창에 전달되는가"는 이 훅으로 증명할 수 없다.
//! 그건 격리 환경(Windows Sandbox/VM) E2E 의 몫이다.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::{overlay, tray, windows};

pub const FLAG: &str = "--debug-cmd";

/// 커맨드라인에서 스크립트를 뽑는다. `--debug-cmd <script>` 와 `--debug-cmd=<script>` 둘 다 지원.
pub fn script_from_args() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if arg == FLAG {
            return iter.next().cloned();
        }
        if let Some(rest) = arg.strip_prefix(&format!("{FLAG}=")) {
            return Some(rest.to_string());
        }
    }
    None
}

/// 스크립트를 별도 스레드에서 순차 실행한다. 마지막 스텝이 `loop` 면 무한 반복.
pub fn spawn(app: &AppHandle, script: String) {
    let handle = app.clone();
    std::thread::spawn(move || {
        let mut steps: Vec<String> = script
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let repeat = steps.last().map(|s| s == "loop").unwrap_or(false);
        if repeat {
            steps.pop();
        }

        println!("[debug-cmd] 스크립트 시작 (loop={repeat}): {}", steps.join(" → "));

        loop {
            for step in &steps {
                run_step(&handle, step);
            }
            if !repeat {
                break;
            }
        }

        println!("[debug-cmd] 스크립트 종료");
    });
}

fn run_step(app: &AppHandle, step: &str) {
    let (cmd, arg) = match step.split_once(':') {
        Some((c, a)) => (c, Some(a)),
        None => (step, None),
    };

    match cmd {
        "wait" => {
            let ms: u64 = arg.and_then(|a| a.parse().ok()).unwrap_or(1000);
            std::thread::sleep(Duration::from_millis(ms));
        }

        // 트레이 [▶ 작업 시작] 과 완전히 같은 핸들러
        "start-session" => tray::start_session_placeholder(),

        "overlay-show" => overlay::trigger(app),
        "overlay-hide" => {
            if let Err(e) = overlay::hide_overlay(app.clone()) {
                eprintln!("[debug-cmd] overlay-hide 실패: {e}");
            }
        }

        // 프론트엔드의 dismiss() 를 그대로 태운다 (로그 → 슬라이드 아웃 → hide 체인 검증)
        "overlay-action" => {
            let action = arg.unwrap_or("done");
            if let Err(e) = app.emit_to(overlay::OVERLAY_LABEL, "overlay://debug-action", action) {
                eprintln!("[debug-cmd] overlay-action 전송 실패: {e}");
            }
        }

        "settings-open" => windows::show_settings_window(app),
        "main-show" => windows::show_window(app, windows::MAIN_LABEL),
        "main-hide" => {
            if let Some(w) = app.get_webview_window(windows::MAIN_LABEL) {
                let _ = w.hide();
            }
        }

        "dump" => dump(app),

        // 트레이 [종료] 와 같은 경로
        "quit" => {
            println!("[debug-cmd] quit — 트레이 [종료] 와 동일 경로");
            app.exit(0);
        }

        other => eprintln!("[debug-cmd] 알 수 없는 명령: '{other}'"),
    }
}

/// 창 상태를 기계가 파싱하기 쉬운 형태로 찍는다.
fn dump(app: &AppHandle) {
    for label in [windows::MAIN_LABEL, windows::SETTINGS_LABEL] {
        let visible = app
            .get_webview_window(label)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);
        println!("[debug-cmd] dump {label}.visible={visible}");
    }

    // 오버레이는 tao 의 visible 캐시를 우회해 띄우므로 반드시 Win32 로 직접 물어봐야 한다
    // (docs/decisions/0001 참고 — is_visible() 을 쓰면 항상 false 가 나온다)
    println!(
        "[debug-cmd] dump {}.visible={}",
        overlay::OVERLAY_LABEL,
        overlay::is_visible(app)
    );
}
