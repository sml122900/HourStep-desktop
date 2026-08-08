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

/// `--debug-cmd tick:<ms>` 가 주입하는 가상 시각 오프셋.
/// 릴리스 빌드에는 이걸 건드리는 경로가 없으므로 항상 0이다.
static CLOCK_OFFSET_MS: AtomicI64 = AtomicI64::new(0);

/// 진행 중인 세션의 startedAt (epoch ms). 없으면 세션 미시작.
pub struct SessionState(pub Mutex<Option<i64>>);

/// `startedAt` 이 있으면 시작, 없으면 종료(그때는 `endedAt` 이 채워진다).
#[derive(Clone, Serialize)]
struct SessionChanged {
    #[serde(rename = "startedAt")]
    started_at: Option<i64>,
    #[serde(rename = "endedAt")]
    ended_at: Option<i64>,
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
    emit_changed(app, Some(now), None);
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
    let ended = now_ms();
    println!(
        "[session] 종료 startedAt={started} endedAt={ended} 작업시간={}분",
        (ended - started) / 60_000
    );
    crate::tray::set_session_active(app, false);
    emit_changed(app, None, Some(ended));
}

/// 모든 웹뷰로 방송한다 — 오버레이는 스케줄 때문에, 메인 창은 통계 갱신 때문에 필요하다.
/// (1초 tick 은 오버레이에만 보낸다. 메인 창까지 매초 깨울 이유가 없다)
fn emit_changed(app: &AppHandle, started_at: Option<i64>, ended_at: Option<i64>) {
    if let Err(e) = app.emit(
        "session://changed",
        SessionChanged {
            started_at,
            ended_at,
        },
    ) {
        eprintln!("[session] session://changed 전송 실패: {e}");
    }
}

/// 1초 tick. 세션 유무와 무관하게 돌고, 판단은 TS 가 한다.
///
/// D2.5 부터 **모든 창**에 보낸다(원래는 오버레이 전용이었다). 메인 창의 경과시간·다음 알림
/// 카운트다운이 오버레이의 발화 판단과 같은 시각을 봐야 하기 때문 — 메인 창이 `Date.now()` 를
/// 쓰면 `--debug-cmd tick:` 의 가상 시각과 갈라져 표시값과 실제 발화가 어긋난다.
/// 숨어 있는 창은 `document.hidden` 을 보고 렌더를 건너뛴다.
pub fn spawn_tick(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let _ = handle.emit("app://tick", Tick { now: now_ms() });
    });
}

/// 오버레이의 세션 미시작 리마인더와 메인 창의 [▶ 작업 시작] 버튼.
/// 트레이 메뉴와 완전히 같은 경로다 — 어디서 눌러도 `session://changed` 한 줄기로 합쳐진다.
#[tauri::command]
pub fn start_session_command(app: AppHandle) {
    start(&app);
}

/// 메인 창의 [■ 작업 종료] 버튼. 트레이 메뉴와 같은 경로.
#[tauri::command]
pub fn end_session_command(app: AppHandle) {
    end(&app);
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

/// 프론트엔드가 자동 검증용 한 줄을 Rust stdout 으로 흘려보내는 통로.
/// DB 는 어댑터(`src/data/db.ts`)만 읽으므로, `--debug-cmd db-dump` 의 결과도 이 길로 나온다.
#[tauri::command]
pub fn log_debug(line: String) {
    println!("[debug] {line}");
}
