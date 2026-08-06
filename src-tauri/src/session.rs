//! 세션 상태 + 1초 tick.
//!
//! **왜 Rust 가 시계를 갖는가**: 스케줄 계산 자체는 `src/core/scheduler.ts` 의 순수 함수지만,
//! 그걸 돌릴 주기 신호는 Rust 가 준다. 웹뷰가 숨겨져 있을 때 Chromium 이 setTimeout/setInterval 을
//! 분 단위로 스로틀링하기 때문 — 자바스크립트 타이머로는 50분 뒤 알림을 신뢰할 수 없다.
//! `std::thread::sleep` 은 스로틀링 대상이 아니다.
//!
//! 그래서 역할 분담은: **Rust = 시계, TS = 판단.** Rust 는 1초마다 `app://tick { now }` 만
//! 보내고, 무엇이 언제 떠야 하는지는 오버레이 웹뷰의 TS 가 순수 함수로 계산한다.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::overlay::OVERLAY_LABEL;

/// `--debug-cmd tick:<ms>` 가 주입하는 가상 시각 오프셋.
/// 릴리스 빌드에는 이걸 건드리는 경로가 없으므로 항상 0이다.
static CLOCK_OFFSET_MS: AtomicI64 = AtomicI64::new(0);

/// 진행 중인 세션의 startedAt (epoch ms). 없으면 세션 미시작.
pub struct SessionState(pub Mutex<Option<i64>>);

#[derive(Clone, Serialize)]
struct SessionChanged {
    #[serde(rename = "startedAt")]
    started_at: Option<i64>,
}

#[derive(Clone, Serialize)]
struct Tick {
    now: i64,
}

/// 앱 전역에서 쓰는 "지금". 가상 오프셋이 반영된다.
pub fn now_ms() -> i64 {
    let real = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    real + CLOCK_OFFSET_MS.load(Ordering::Relaxed)
}

/// 가상 시각을 앞으로 감는다. 스케줄러의 `now` 주입과 완전히 같은 경로를 탄다.
#[cfg_attr(not(debug_assertions), allow(dead_code))]
pub fn advance_clock(ms: i64) {
    let offset = CLOCK_OFFSET_MS.fetch_add(ms, Ordering::Relaxed) + ms;
    println!("[session] 가상 시각 +{ms}ms (누적 offset={offset}ms)");
}

pub fn started_at(app: &AppHandle) -> Option<i64> {
    *app.state::<SessionState>().0.lock().ok()?
}

/// 트레이 [작업 시작]/[작업 종료] 토글. 반환값은 토글 후 활성 여부.
pub fn toggle(app: &AppHandle) -> bool {
    if started_at(app).is_some() {
        end(app);
        false
    } else {
        start(app);
        true
    }
}

pub fn start(app: &AppHandle) {
    let now = now_ms();
    if let Ok(mut guard) = app.state::<SessionState>().0.lock() {
        if guard.is_some() {
            println!("[session] 이미 진행 중 — 무시");
            return;
        }
        *guard = Some(now);
    }
    println!("[session] 시작 startedAt={now}");
    crate::tray::set_session_active(app, true);
    emit_changed(app, Some(now));
}

pub fn end(app: &AppHandle) {
    let started = {
        let state = app.state::<SessionState>();
        let Ok(mut guard) = state.0.lock() else { return };
        guard.take()
    };
    let Some(started) = started else {
        println!("[session] 진행 중인 세션 없음 — 무시");
        return;
    };
    println!(
        "[session] 종료 startedAt={started} 작업시간={}분",
        (now_ms() - started) / 60_000
    );
    crate::tray::set_session_active(app, false);
    emit_changed(app, None);
}

fn emit_changed(app: &AppHandle, started_at: Option<i64>) {
    if let Err(e) = app.emit_to(OVERLAY_LABEL, "session://changed", SessionChanged { started_at }) {
        eprintln!("[session] session://changed 전송 실패: {e}");
    }
}

/// 1초 tick 을 오버레이 웹뷰로 계속 보낸다. 세션 유무와 무관하게 돌고, 판단은 TS 가 한다.
pub fn spawn_tick(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let _ = handle.emit_to(OVERLAY_LABEL, "app://tick", Tick { now: now_ms() });
    });
}

/// 오버레이 웹뷰가 뜬 직후 현재 세션 상태를 물어보는 용도.
/// (창이 만들어지기 전에 발행된 `session://changed` 를 놓칠 수 있어서 필요하다)
#[tauri::command]
pub fn current_session(app: AppHandle) -> Option<i64> {
    started_at(&app)
}

/// TS 가 남긴 CompletionLog 를 Rust stdout 에도 찍는다 (자동 검증에서 파싱한다).
#[tauri::command]
pub fn log_completion(behavior: String, action: String, at: i64) {
    println!("[session] log behavior={behavior} action={action} at={at}");
}
