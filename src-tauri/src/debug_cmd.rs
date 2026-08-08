//! `--debug-cmd` 디버그 훅 (개발 빌드 전용).
//!
//! CLAUDE.md 「검증 정책」: 사용자 데스크톱에 합성 입력을 주입하지 않고 자동 검증하기 위한 경로다.
//! 트레이 클릭이나 마우스 클릭이 필요한 시나리오를 **같은 핸들러를 직접 호출**해서 대체한다.
//!
//! ```powershell
//! # D1 코어 루프: 세션 시작 → 30분 점프 → 물마시기 카드 → 완료 → 종료
//! pnpm tauri dev -- -- -- --debug-cmd "wait:4000,start-session,wait:1500,tick:1800000,wait:2500,dump,done,wait:1500,dump,end-session,wait:1000,dump,quit"
//!
//! # 스누즈 병합: 57분 시점에 스누즈 → 3분 뒤(60분) 정규와 겹쳐 병합되어야 한다
//! pnpm tauri dev -- -- -- --debug-cmd "wait:4000,start-session,tick:3420000,wait:2500,snoozed,wait:1500,tick:180000,wait:3000,dump,quit"
//!
//! # 오버레이 표시 → 완료 액션 → 숨김 (B-4 의 액션 체인)
//! pnpm tauri dev -- -- -- --debug-cmd "wait:3000,overlay-show,wait:2000,done,wait:1500,dump,quit"
//!
//! # 전체화면 테스트용 반복 표시 (C 항목)
//! pnpm tauri dev -- -- -- --debug-cmd "wait:8000,overlay-show,wait:8000,overlay-hide,wait:12000,loop"
//!
//! # D2.5 행동 CRUD 가 실행 중 세션 스케줄에 즉시 반영되는가
//! pnpm tauri dev -- -- -- --debug-cmd "wait:4000,start-session,behavior-add:jump=7,wait:1500,behaviors-dump,tick:420000,wait:2500,dump,done,wait:1500,behavior-delete:jump,wait:1500,behaviors-dump,quit"
//! ```
//!
//! 한계: 이 훅은 **자기 프로세스 안에서만** 동작한다. 이미 떠 있는 다른 인스턴스에는 명령을
//! 보낼 수 없다. D1 에서 single-instance 를 넣었으므로 dev 인스턴스가 이미 떠 있으면
//! 두 번째 실행은 그냥 종료된다 — 스크립트를 돌리기 전에 기존 인스턴스를 반드시 끌 것.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::{overlay, session, windows};

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

/// DB 를 만지는 검증 명령은 Rust 가 직접 못 한다 — 읽기/쓰기는 `src/data/db.ts` 어댑터만
/// 한다는 규칙(CLAUDE.md 「저장소」) 때문. 오버레이 웹뷰에 요청하고 결과는 `log_debug` 로 받는다.
fn ask_overlay<T: serde::Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    if let Err(e) = app.emit_to(overlay::OVERLAY_LABEL, event, payload) {
        eprintln!("[debug-cmd] {event} 전송 실패: {e}");
    }
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

        // 트레이 [▶ 작업 시작] / [■ 작업 종료] 와 완전히 같은 핸들러
        "start-session" => session::start(app),
        "end-session" => session::end(app),

        // 가상 시각을 앞으로 감는다. 스케줄러의 now 주입과 같은 경로 —
        // 50분 간격 알림을 실제로 50분 기다리지 않고 검증하기 위한 것.
        "tick" => {
            let ms: i64 = arg.and_then(|a| a.parse().ok()).unwrap_or(60_000);
            session::advance_clock(ms);
        }

        "overlay-show" => overlay::trigger(app, arg.unwrap_or(overlay::TEST_BEHAVIOR_ID)),
        "overlay-hide" => {
            if let Err(e) = overlay::hide_overlay(app.clone()) {
                eprintln!("[debug-cmd] overlay-hide 실패: {e}");
            }
        }

        // 프론트엔드의 dismiss() 를 그대로 태운다 (로그 → 슬라이드 아웃 → hide 체인 검증).
        // `done` / `snoozed` / `skipped` 는 자주 쓰므로 별칭을 준다.
        "overlay-action" | "done" | "snoozed" | "skipped" => {
            let action = if cmd == "overlay-action" { arg.unwrap_or("done") } else { cmd };
            if let Err(e) = app.emit_to(overlay::OVERLAY_LABEL, "overlay://debug-action", action) {
                eprintln!("[debug-cmd] overlay-action 전송 실패: {e}");
            }
        }

        // 메인 창이 화면에 그리고 있는 값(경과시간·다음 알림 남은 시간)을 stdout 으로.
        // `dump` 의 clock.now / elapsedMs 와 대조하면 표시값과 실제 발화 시각이 맞는지 보인다.
        "main-dump" => {
            if let Err(e) = app.emit_to(windows::MAIN_LABEL, "main://debug-dump", ()) {
                eprintln!("[debug-cmd] main-dump 전송 실패: {e}");
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

        // DB 는 어댑터(src/data/db.ts)만 읽는다. 그래서 Rust 가 직접 못 찍고 웹뷰에 요청한다 —
        // 결과는 `log_debug` 를 타고 `[debug] db ...` 로 stdout 에 나온다.
        "db-dump" => ask_overlay(app, "overlay://debug-db-dump", ()),

        // 스케줄러가 실제로 받는 행동 목록. `[debug] behaviors n=… 0:stretch(🧘스트레칭,50m,on,builtin) …`
        "behaviors-dump" => ask_overlay(app, "overlay://debug-behaviors-dump", ()),

        // `set-interval:water=5` — 설정 창의 저장·방송 경로(saveBehaviorsAndBroadcast)를 그대로 탄다.
        // "설정 변경이 실행 중 세션 스케줄에 즉시 반영되는가"를 클릭 없이 검증하기 위한 것.
        "set-interval" => match arg {
            Some(spec) => ask_overlay(app, "overlay://debug-behavior", format!("interval:{spec}")),
            None => eprintln!("[debug-cmd] set-interval 은 '<behaviorId>=<분>' 형식이 필요합니다"),
        },

        // 행동 CRUD 도 설정 창과 같은 경로를 탄다 (D2.5 검증: 실행 중 세션에 즉시 반영되는가).
        //   behavior-add:jump=7      새 행동을 7분 간격으로 추가
        //   behavior-delete:water    삭제
        //   behavior-restore         「기본값 복원」
        "behavior-add" => match arg {
            Some(spec) => ask_overlay(app, "overlay://debug-behavior", format!("add:{spec}")),
            None => eprintln!("[debug-cmd] behavior-add 는 '<id>=<분>' 형식이 필요합니다"),
        },
        "behavior-delete" => match arg {
            Some(id) => ask_overlay(app, "overlay://debug-behavior", format!("delete:{id}")),
            None => eprintln!("[debug-cmd] behavior-delete 는 '<id>' 가 필요합니다"),
        },
        "behavior-restore" => ask_overlay(app, "overlay://debug-behavior", "restore".to_string()),

        // `set-theme:light|dark|system` — 설정 창의 테마 저장 경로를 그대로 탄다.
        "set-theme" => match arg {
            Some(pref) => ask_overlay(app, "overlay://debug-set-theme", pref.to_string()),
            None => eprintln!("[debug-cmd] set-theme 은 'light|dark|system' 이 필요합니다"),
        },

        // 트레이 [종료] 와 같은 경로
        "quit" => {
            println!("[debug-cmd] quit — 트레이 [종료] 와 동일 경로");
            app.exit(0);
        }

        other => eprintln!("[debug-cmd] 알 수 없는 명령: '{other}'"),
    }
}

/// 창·세션 상태를 기계가 파싱하기 쉬운 형태로 찍는다.
fn dump(app: &AppHandle) {
    let now = session::now_ms();
    match session::started_at(app) {
        Some(started) => println!(
            "[debug-cmd] dump session.active=true startedAt={started} elapsedMs={}",
            now - started
        ),
        None => println!("[debug-cmd] dump session.active=false"),
    }
    println!("[debug-cmd] dump clock.now={now}");

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
