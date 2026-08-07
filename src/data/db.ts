/**
 * SQLite 어댑터 — IO 가 있는 유일한 계층.
 *
 * CLAUDE.md 규칙: `src/core/` 는 IO 금지. DB 접근은 전부 여기를 지난다.
 * 스키마·마이그레이션은 Rust 쪽 `src-tauri/src/db.rs` 가 소유한다.
 */

import { emit } from '@tauri-apps/api/event'
import Database from '@tauri-apps/plugin-sql'
import type { AppSettings } from '../core/settings'
import { normalizeSettings } from '../core/settings'
import type { CompletionLog, WorkSession } from '../core/types'

/** src-tauri/src/db.rs 의 `DB_URL` 과 반드시 같아야 한다 */
const DB_URL = 'sqlite:hourstep.db'

const SETTINGS_KEY = 'app_settings'

let handle: Promise<Database> | null = null

function db(): Promise<Database> {
  handle ??= Database.load(DB_URL)
  return handle
}

interface SessionRow {
  id: string
  started_at: number
  ended_at: number | null
}

interface LogRow {
  session_id: string
  behavior_id: string
  action: CompletionLog['action']
  at: number
  occurrence_id: string
}

const toSession = (r: SessionRow): WorkSession => ({
  id: r.id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
})

const toLog = (r: LogRow): CompletionLog => ({
  occurrenceId: r.occurrence_id,
  behaviorId: r.behavior_id,
  action: r.action,
  at: r.at,
})

// ─── 세션 ────────────────────────────────────────────────────────────────

export async function insertSession(session: WorkSession): Promise<void> {
  const conn = await db()
  await conn.execute(
    'INSERT OR REPLACE INTO work_sessions (id, started_at, ended_at) VALUES ($1, $2, $3)',
    [session.id, session.startedAt, session.endedAt]
  )
}

export async function closeSession(id: string, endedAt: number): Promise<void> {
  const conn = await db()
  await conn.execute('UPDATE work_sessions SET ended_at = $1 WHERE id = $2', [endedAt, id])
}

/**
 * 앱이 강제 종료되면 `ended_at` 이 NULL 인 세션이 남는다. 그대로 두면 통계에서
 * "지금도 진행 중"으로 잡혀 작업시간이 무한정 늘어난다.
 *
 * 실제 종료 시각을 알 수 없으므로 **그 세션의 마지막 활동 기록 시각**으로 닫는다.
 * 기록이 하나도 없으면 시작 시각으로 닫는다(= 작업시간 0).
 *
 * @param bootedAt 이 시각보다 **먼저** 시작된 세션만 닫는다. 이게 없으면 앱 기동 직후
 *   사용자가 바로 [작업 시작]을 눌렀을 때, 정리 쿼리가 방금 만든 살아 있는 세션까지
 *   닫아버릴 수 있다 (정리와 세션 생성이 둘 다 비동기라 순서가 보장되지 않는다).
 */
export async function closeDanglingSessions(bootedAt: number): Promise<number> {
  const conn = await db()
  const result = await conn.execute(
    `UPDATE work_sessions
        SET ended_at = COALESCE(
              (SELECT MAX(at) FROM completion_logs WHERE session_id = work_sessions.id),
              started_at)
      WHERE ended_at IS NULL AND started_at < $1`,
    [bootedAt]
  )
  return result.rowsAffected
}

/** `[from, to)` 와 **겹치는** 세션. 자정을 넘는 세션이 양쪽 날짜에 다 잡히도록 겹침 기준이다. */
export async function loadSessions(from: number, to: number): Promise<WorkSession[]> {
  const conn = await db()
  const rows = await conn.select<SessionRow[]>(
    `SELECT id, started_at, ended_at FROM work_sessions
      WHERE started_at < $2 AND (ended_at IS NULL OR ended_at >= $1)
      ORDER BY started_at`,
    [from, to]
  )
  return rows.map(toSession)
}

export async function loadSessionLogs(sessionId: string): Promise<CompletionLog[]> {
  const conn = await db()
  const rows = await conn.select<LogRow[]>(
    `SELECT session_id, behavior_id, action, at, occurrence_id
       FROM completion_logs WHERE session_id = $1 ORDER BY at`,
    [sessionId]
  )
  return rows.map(toLog)
}

// ─── 실천 기록 ───────────────────────────────────────────────────────────

export async function insertLog(sessionId: string, log: CompletionLog): Promise<void> {
  const conn = await db()
  await conn.execute(
    `INSERT INTO completion_logs (session_id, behavior_id, action, at, occurrence_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, log.behaviorId, log.action, log.at, log.occurrenceId]
  )
}

export async function loadLogs(from: number, to: number): Promise<CompletionLog[]> {
  const conn = await db()
  const rows = await conn.select<LogRow[]>(
    `SELECT session_id, behavior_id, action, at, occurrence_id
       FROM completion_logs WHERE at >= $1 AND at < $2 ORDER BY at`,
    [from, to]
  )
  return rows.map(toLog)
}

// ─── 설정 ────────────────────────────────────────────────────────────────

export async function loadSettings(): Promise<AppSettings> {
  const conn = await db()
  const rows = await conn.select<{ value: string }[]>(
    'SELECT value FROM settings WHERE key = $1',
    [SETTINGS_KEY]
  )
  if (rows.length === 0) return normalizeSettings(null)

  try {
    return normalizeSettings(JSON.parse(rows[0].value))
  } catch {
    // 손상된 JSON 이 앱을 못 켜게 만들면 안 된다. 기본값으로 살아난다.
    console.error('[db] 설정 JSON 파싱 실패 — 기본값 사용')
    return normalizeSettings(null)
  }
}

// ─── 자동 검증용 ─────────────────────────────────────────────────────────

/** `--debug-cmd db-dump` 이 찍을 한 줄. write→재시작→read 왕복 확인에 쓴다. */
export async function summarize(): Promise<string> {
  const conn = await db()
  const [sessions] = await conn.select<{ n: number; open: number; worked: number }[]>(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) AS open,
            COALESCE(SUM(COALESCE(ended_at, started_at) - started_at), 0) AS worked
       FROM work_sessions`
  )
  const [logs] = await conn.select<{ n: number; done: number }[]>(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN action = 'done' THEN 1 ELSE 0 END) AS done
       FROM completion_logs`
  )
  return (
    `db sessions=${sessions.n} open=${sessions.open ?? 0} workedMs=${sessions.worked} ` +
    `logs=${logs.n} done=${logs.done ?? 0}`
  )
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const conn = await db()
  await conn.execute(
    'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
    [SETTINGS_KEY, JSON.stringify(settings)]
  )
}

/**
 * 저장한 뒤 모든 창에 알린다. 오버레이가 이걸 받아 실행 중인 세션의 스케줄을 다시 계산한다.
 *
 * 저장이 실패하면 방송하지 않는다 — 화면·DB·스케줄이 갈라지면 안 된다.
 * 설정 창과 `--debug-cmd set-interval` 이 **같은 함수**를 타야 검증이 의미를 갖는다.
 */
export async function saveSettingsAndBroadcast(draft: AppSettings): Promise<AppSettings> {
  const settings = normalizeSettings(draft)
  await saveSettings(settings)
  await emit('settings://changed')
  return settings
}
