/**
 * SQLite 어댑터 — IO 가 있는 유일한 계층.
 *
 * CLAUDE.md 규칙: `src/core/` 는 IO 금지. DB 접근은 전부 여기를 지난다.
 * 스키마·마이그레이션은 Rust 쪽 `src-tauri/src/db.rs` 가 소유한다.
 */

import { emit } from '@tauri-apps/api/event'
import Database from '@tauri-apps/plugin-sql'
import { applyLegacyBehaviorSettings, intervalMinutes, normalizeBehaviors } from '../core/behaviors'
import { seedBehaviors } from '../core/presets'
import type { AppSettings } from '../core/settings'
import { extractLegacyBehaviors, normalizeSettings } from '../core/settings'
import type { Behavior, CompletionLog, WorkSession } from '../core/types'

/** src-tauri/src/db.rs 의 `DB_URL` 과 반드시 같아야 한다 */
const DB_URL = 'sqlite:hourstep.db'

const SETTINGS_KEY = 'app_settings'

/** 행동 목록이 바뀌었다. 오버레이·메인 창이 받아서 스케줄과 표시를 다시 만든다. */
export const BEHAVIORS_CHANGED = 'behaviors://changed'
export const SETTINGS_CHANGED = 'settings://changed'

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
  behavior_label: string
  action: CompletionLog['action']
  at: number
  occurrence_id: string
}

interface BehaviorRow {
  id: string
  label: string
  emoji: string
  message: string
  every_ms: number
  duration_sec: number
  enabled: number
  is_builtin: number
  source: string
  sort_order: number
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
  behaviorLabel: r.behavior_label || undefined,
})

// SQLite 에는 boolean 이 없다. 0/1 로 넣고 나올 때 되돌린다.
const toBehavior = (r: BehaviorRow): Behavior => ({
  id: r.id,
  label: r.label,
  emoji: r.emoji,
  message: r.message ?? '',
  rule: { kind: 'interval', everyMs: r.every_ms },
  intensity: 'card',
  enabled: r.enabled !== 0,
  // 범위(0~600) 정리는 normalizeBehaviors 가 한다. v4 이전 행은 마이그레이션이 채웠다
  durationSec: r.duration_sec,
  isBuiltin: r.is_builtin !== 0,
  // 범위 밖 값 정리는 normalizeBehaviors 가 한다 (v3 이전 행은 DEFAULT 로 'user')
  source: r.source === 'ai' ? 'ai' : 'user',
  sortOrder: r.sort_order,
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
    `SELECT session_id, behavior_id, behavior_label, action, at, occurrence_id
       FROM completion_logs WHERE session_id = $1 ORDER BY at`,
    [sessionId]
  )
  return rows.map(toLog)
}

// ─── 실천 기록 ───────────────────────────────────────────────────────────

export async function insertLog(sessionId: string, log: CompletionLog): Promise<void> {
  const conn = await db()
  await conn.execute(
    `INSERT INTO completion_logs
       (session_id, behavior_id, behavior_label, action, at, occurrence_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, log.behaviorId, log.behaviorLabel ?? '', log.action, log.at, log.occurrenceId]
  )
}

export async function loadLogs(from: number, to: number): Promise<CompletionLog[]> {
  const conn = await db()
  const rows = await conn.select<LogRow[]>(
    `SELECT session_id, behavior_id, behavior_label, action, at, occurrence_id
       FROM completion_logs WHERE at >= $1 AND at < $2 ORDER BY at`,
    [from, to]
  )
  return rows.map(toLog)
}

// ─── 행동 ────────────────────────────────────────────────────────────────

/**
 * 표가 비어 있으면 시드를 심는다. 창 세 개가 동시에 부팅하며 각자 부르므로
 * `INSERT OR IGNORE` 로 겹쳐 들어와도 무해하게 만들었다.
 *
 * v1 → v2 로 올라오는 경우 D2 설정 JSON 에 들어 있던 on/off·간격을 **한 번** 흡수한다.
 * 흡수한 뒤에는 정규화된 설정을 다시 써서 낡은 `behaviors` 필드를 지운다
 * (`normalizeSettings` 가 그 필드를 버리므로 저장만 하면 사라진다).
 */
async function seedBehaviorsIfEmpty(): Promise<void> {
  const conn = await db()
  const [{ n }] = await conn.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM behaviors')
  if (n > 0) return

  const legacy = extractLegacyBehaviors(await readSettingsJson())
  const seeded = applyLegacyBehaviorSettings(seedBehaviors(), legacy)
  console.log('[db] behaviors 시드', legacy ? '(D2 설정 흡수)' : '(기본값)')

  for (const behavior of seeded) await upsertBehavior(behavior, 'INSERT OR IGNORE')
  if (legacy) await saveSettings(await loadSettings())
}

function upsertBehavior(behavior: Behavior, verb: 'INSERT OR IGNORE' | 'INSERT OR REPLACE') {
  return db().then((conn) =>
    conn.execute(
      `${verb} INTO behaviors
         (id, label, emoji, message, every_ms, duration_sec, enabled, is_builtin, source, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        behavior.id,
        behavior.label,
        behavior.emoji,
        behavior.message,
        intervalMinutes(behavior) * 60_000,
        behavior.durationSec,
        behavior.enabled ? 1 : 0,
        behavior.isBuiltin ? 1 : 0,
        behavior.source,
        behavior.sortOrder,
      ]
    )
  )
}

/** 런타임 행동 목록. 저장된 값을 그대로 믿지 않고 항상 정규화해서 내보낸다. */
export async function loadBehaviors(): Promise<Behavior[]> {
  await seedBehaviorsIfEmpty()
  const conn = await db()
  const rows = await conn.select<BehaviorRow[]>(
    `SELECT id, label, emoji, message, every_ms, duration_sec, enabled, is_builtin, source, sort_order
       FROM behaviors ORDER BY sort_order, id`
  )
  return normalizeBehaviors(rows.map(toBehavior))
}

/**
 * 목록 전체를 저장한다 (없어진 id 는 삭제). 저장이 실패하면 방송하지 않는다 —
 * 화면·DB·스케줄이 갈라지면 안 된다. 설정 창과 `--debug-cmd` 가 **같은 함수**를 타야
 * 검증이 의미를 갖는다.
 */
export async function saveBehaviorsAndBroadcast(draft: Behavior[]): Promise<Behavior[]> {
  const behaviors = normalizeBehaviors(draft)
  const conn = await db()

  // 파라미터 바인딩을 쓸 수 있게 자리표시자를 개수만큼 만든다 (id 를 문자열로 잇지 않는다)
  const holes = behaviors.map((_, i) => `$${i + 1}`).join(', ')
  await conn.execute(
    behaviors.length === 0
      ? 'DELETE FROM behaviors'
      : `DELETE FROM behaviors WHERE id NOT IN (${holes})`,
    behaviors.map((b) => b.id)
  )
  for (const behavior of behaviors) await upsertBehavior(behavior, 'INSERT OR REPLACE')

  await emit(BEHAVIORS_CHANGED)
  return behaviors
}

// ─── 설정 ────────────────────────────────────────────────────────────────

/** 저장된 설정 JSON 을 파싱만 해서 준다. 정규화 전 원본이 필요한 곳(레거시 흡수)용. */
async function readSettingsJson(): Promise<unknown> {
  const conn = await db()
  const rows = await conn.select<{ value: string }[]>('SELECT value FROM settings WHERE key = $1', [
    SETTINGS_KEY,
  ])
  if (rows.length === 0) return null

  try {
    return JSON.parse(rows[0].value)
  } catch {
    // 손상된 JSON 이 앱을 못 켜게 만들면 안 된다. 기본값으로 살아난다.
    console.error('[db] 설정 JSON 파싱 실패 — 기본값 사용')
    return null
  }
}

export async function loadSettings(): Promise<AppSettings> {
  return normalizeSettings((await readSettingsJson()) as Partial<AppSettings> | null)
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const conn = await db()
  await conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
    SETTINGS_KEY,
    JSON.stringify(settings),
  ])
}

/**
 * 저장한 뒤 모든 창에 알린다. 오버레이가 이걸 받아 실행 중인 세션의 스케줄을 다시 계산하고,
 * 세 창이 테마를 다시 칠한다.
 *
 * 저장이 실패하면 방송하지 않는다 — 화면·DB·스케줄이 갈라지면 안 된다.
 */
export async function saveSettingsAndBroadcast(draft: AppSettings): Promise<AppSettings> {
  const settings = normalizeSettings(draft)
  await saveSettings(settings)
  await emit(SETTINGS_CHANGED)
  return settings
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
  const [logs] = await conn.select<{ n: number; done: number; labeled: number }[]>(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN action = 'done' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN behavior_label <> '' THEN 1 ELSE 0 END) AS labeled
       FROM completion_logs`
  )
  // 별칭에 `on` 을 쓰지 않는다 — SQLite 예약어(JOIN ... ON)라 파싱이 깨진다
  const [behaviors] = await conn.select<{ n: number; enabled_n: number; ai_n: number }[]>(
    `SELECT COUNT(*) AS n, SUM(enabled) AS enabled_n,
            SUM(CASE WHEN source = 'ai' THEN 1 ELSE 0 END) AS ai_n
       FROM behaviors`
  )
  return (
    `db sessions=${sessions.n} open=${sessions.open ?? 0} workedMs=${sessions.worked} ` +
    `logs=${logs.n} done=${logs.done ?? 0} labeled=${logs.labeled ?? 0} ` +
    `behaviors=${behaviors.n} enabled=${behaviors.enabled_n ?? 0} ai=${behaviors.ai_n ?? 0}`
  )
}

/** `--debug-cmd behaviors-dump` — 스케줄러가 실제로 받는 목록 그대로 찍는다. */
export async function summarizeBehaviors(): Promise<string> {
  const behaviors = await loadBehaviors()
  const parts = behaviors.map(
    (b) =>
      `${b.sortOrder}:${b.id}(${b.emoji}${b.label},${intervalMinutes(b)}m,${b.durationSec}s,` +
      `${b.enabled ? 'on' : 'off'}${b.isBuiltin ? ',builtin' : ''}` +
      `${b.source === 'ai' ? ',ai' : ''})`
  )
  return `behaviors n=${behaviors.length} ${parts.join(' ')}`
}
