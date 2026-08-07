//! SQLite 스키마 정의. 실제 읽기/쓰기는 프론트엔드 어댑터(`src/data/db.ts`)가 한다.
//!
//! Rust 는 마이그레이션만 소유한다 — `tauri-plugin-sql` 이 JS 쪽에 쿼리 API 를 주고,
//! 세션 런타임이 이미 오버레이 웹뷰에 있어서 DB 접근 지점을 한 군데로 모으는 게 낫다.
//! (CLAUDE.md: `src/core/` 는 IO 금지, DB 접근은 `src/data/` 어댑터에만)

use tauri_plugin_sql::{Migration, MigrationKind};

/// `Database.load()` 에 넘기는 URL. 프론트엔드 `src/data/db.ts` 의 상수와 반드시 같아야 한다.
pub const DB_URL: &str = "sqlite:hourstep.db";

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
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
    }]
}
