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
    // D2.7 — 행위 자체에 걸리는 시간(초). 0 이면 즉시 행동(물마시기), 0 보다 크면
    // [완료]가 카운트다운을 시작한다. D2 의 `countdown_ms`(하드코딩 60초 제안)를 대체한다.
    //
    // `countdown_ms` 열은 **지우지 않고 남겨 둔다**. SQLite 의 DROP COLUMN 은 버전을 타고,
    // 이 마이그레이션이 실패하면 앱이 아예 안 켜진다. 값을 옮긴 뒤로는 아무도 읽지 않는다
    // (어댑터의 SELECT/INSERT 목록에서 빠졌다).
    Migration {
        version: 4,
        description: "behavior_duration_sec",
        kind: MigrationKind::Up,
        sql: "
            ALTER TABLE behaviors ADD COLUMN duration_sec INTEGER NOT NULL DEFAULT 0;

            -- 기존 카운트다운 값을 그대로 흡수한다. 사용자가 고쳐 둔 값이 있으면 그게 살아난다.
            UPDATE behaviors SET duration_sec = countdown_ms / 1000 WHERE countdown_ms > 0;

            -- 눈휴식은 「눈감고 1분」이 행동 정의 자체인데(CLAUDE.md 시드 루틴) D2 에는
            -- 카운트다운이 붙어 있지 않아 흡수할 값이 없다. 내장 눈휴식에만, 아직 0 일 때만 채운다.
            UPDATE behaviors SET duration_sec = 60
             WHERE id = 'eyes' AND is_builtin = 1 AND duration_sec = 0;
        ",
    },
    // D2.9 — 근거 프로토콜 연결. 두 가지를 한 버전에 묶는다(v2 도 그랬다):
    // ① 신체정보(성별·연령대) — 수분 참고 기준이 성별·연령별이라서 필요하다. 선택 입력,
    //    체중 등은 수집하지 않는다. 별도 `profile` 테이블(싱글턴 행)로 둔다 — 향후 계정 동기화
    //    로드맵에서 `settings` 의 불투명 JSON 한 덩어리보다 열 단위로 다루기 쉽다.
    // ② 동작 로테이션 — 스트레칭 카드가 매 발화 다음 동작으로 넘어간다. 상태(마지막 인덱스)는
    //    그 행동 자체에 속하는 사실이라 `behaviors` 행에 둔다(`duration_sec` 과 같은 결).
    Migration {
        version: 5,
        description: "profile_and_action_rotation",
        kind: MigrationKind::Up,
        sql: "
            CREATE TABLE IF NOT EXISTS profile (
                id        INTEGER PRIMARY KEY CHECK (id = 1),
                sex       TEXT,
                age_group TEXT
            );
            INSERT OR IGNORE INTO profile (id, sex, age_group) VALUES (1, NULL, NULL);

            ALTER TABLE behaviors ADD COLUMN action_index INTEGER NOT NULL DEFAULT 0;
        ",
    },
    // D2.10 — 동작 선택. 스트레칭 로테이션 8종(A1,A2,B1~B4,C1,C2) 중 일부를 끌 수 있다.
    // 전부 켠 상태로 시드해서 기존 사용자는 동작 변화가 없다(로테이션 인덱스도 그대로 보존된다 —
    // 이 표는 `behaviors.action_index` 와 별개라 마이그레이션이 그 값을 건드리지 않는다).
    // id 는 `src/core/actionRotation.ts` 의 `ROTATION_ORDER` 와 반드시 같아야 한다.
    Migration {
        version: 6,
        description: "action_prefs",
        kind: MigrationKind::Up,
        sql: "
            CREATE TABLE IF NOT EXISTS action_prefs (
                action_id TEXT PRIMARY KEY,
                enabled   INTEGER NOT NULL DEFAULT 1
            );
            INSERT OR IGNORE INTO action_prefs (action_id, enabled) VALUES
                ('A1', 1), ('A2', 1), ('B1', 1), ('B2', 1), ('B3', 1), ('B4', 1), ('C1', 1), ('C2', 1);
        ",
    },
    ]
}
