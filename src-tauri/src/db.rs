//! SQLite 스키마 정의. 실제 읽기/쓰기는 프론트엔드 어댑터(`src/data/db.ts`)가 한다.
//!
//! Rust 는 마이그레이션만 소유한다 — `tauri-plugin-sql` 이 JS 쪽에 쿼리 API 를 주고,
//! 세션 런타임이 이미 오버레이 웹뷰에 있어서 DB 접근 지점을 한 군데로 모으는 게 낫다.
//! (CLAUDE.md: `src/core/` 는 IO 금지, DB 접근은 `src/data/` 어댑터에만)

use tauri_plugin_sql::{Migration, MigrationKind};

/// `Database.load()` 에 넘기는 URL. 프론트엔드 `src/data/db.ts` 의 상수와 반드시 같아야 한다.
pub const DB_URL: &str = "sqlite:hourstep.db";

pub fn migrations() -> Vec<Migration> {
    vec![
    Migration {
        version: 1,
        description: "create_sessions_logs_settings",
        kind: MigrationKind::Up,
        sql: "
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS work_sessions (
                id         TEXT PRIMARY KEY,
                started_at INTEGER NOT NULL,
                ended_at   INTEGER
            );

            CREATE TABLE IF NOT EXISTS completion_logs (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id    TEXT NOT NULL,
                behavior_id   TEXT NOT NULL,
                action        TEXT NOT NULL,
                at            INTEGER NOT NULL,
                -- 도메인 타입 CompletionLog.occurrenceId 를 잃지 않기 위해 함께 저장한다.
                -- at(액션 시각) 과 dueAt(예정 시각) 은 다르므로 이 열 없이는 복원할 수 없다.
                occurrence_id TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_logs_at         ON completion_logs(at);
            CREATE INDEX IF NOT EXISTS idx_logs_session    ON completion_logs(session_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_start  ON work_sessions(started_at);
        ",
    },
    // D2.5 — 행동을 사용자가 직접 만들고 지운다. 하드코딩 프리셋이 아니라 이 표가 런타임 소스다.
    // 시드는 여기서 INSERT 하지 않는다: 표가 비어 있으면 `src/data/db.ts` 가 `seedBehaviors()`
    // 로 심는다. 문구·기본 간격의 단일 출처를 `src/core/presets.ts` 한 곳에 두기 위해서다.
    Migration {
        version: 2,
        description: "behaviors_table_and_log_label",
        kind: MigrationKind::Up,
        sql: "
            CREATE TABLE IF NOT EXISTS behaviors (
                id           TEXT PRIMARY KEY,
                label        TEXT NOT NULL,
                emoji        TEXT NOT NULL,
                message      TEXT NOT NULL DEFAULT '',
                every_ms     INTEGER NOT NULL,
                countdown_ms INTEGER,
                enabled      INTEGER NOT NULL DEFAULT 1,
                -- 내장 3종 표시. 향후 근거 기반 프로토콜을 붙일 자리 (지금은 플래그만)
                is_builtin   INTEGER NOT NULL DEFAULT 0,
                sort_order   INTEGER NOT NULL DEFAULT 0
            );

            -- 행동이 삭제돼도 과거 통계가 이름을 잃지 않도록 기록 시점 이름을 스냅샷한다.
            -- FK + ON DELETE SET NULL 대신 스냅샷을 고른 근거: docs/decisions/0006
            ALTER TABLE completion_logs ADD COLUMN behavior_label TEXT NOT NULL DEFAULT '';

            CREATE INDEX IF NOT EXISTS idx_behaviors_order ON behaviors(sort_order);
        ",
    },
    // D2.6 — 「AI로 루틴 찾기」로 들어온 행동의 출처 표시.
    //
    // `is_builtin` 을 겸용하지 않는다: 그건 "내장 3종이냐"는 다른 사실이고, 향후 근거 기반
    // 프로토콜을 붙일 자리다. 하나의 열에 두 의미를 태우면 둘 중 하나는 반드시 어긋난다.
    // 기존 행은 DEFAULT 로 'user' 가 되고, 값 검증은 어댑터의 normalizeBehaviors 가 한다.
    Migration {
        version: 3,
        description: "behavior_source",
        kind: MigrationKind::Up,
        sql: "
            ALTER TABLE behaviors ADD COLUMN source TEXT NOT NULL DEFAULT 'user';
        ",
    },
    ]
}
