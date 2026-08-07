/**
 * 통계 집계 — IO 없는 순수 모듈. React·Tauri import 금지.
 *
 * `now` 와 조회 구간은 전부 인자로 주입받는다. "오늘 0시" 같은 벽시계 경계 계산은
 * 타임존이 필요하므로 호출부(어댑터/UI)에서 구하고, 여기는 epoch ms 구간만 받는다.
 */

import type { CompletionLog, WorkSession } from './types'

/** 조회 구간. `to` 는 미포함(exclusive) */
export interface Range {
  from: number
  to: number
}

export interface BehaviorStat {
  behaviorId: string
  done: number
  snoozed: number
  skipped: number
  total: number
  /** done / total. 기록이 0건이면 `null` — "0%" 와 구분해야 한다 */
  rate: number | null
}

export interface Stats {
  /** 구간과 겹치는 작업시간의 합 */
  workedMs: number
  /** 구간과 겹친 세션 수 */
  sessionCount: number
  byBehavior: BehaviorStat[]
  /** 전체 행동을 합친 값 */
  overall: BehaviorStat
}

/** 세션의 작업시간. 진행 중(endedAt null)이면 `now` 까지로 친다. */
export function sessionWorkedMs(session: WorkSession, now: number): number {
  const end = session.endedAt ?? now
  return Math.max(0, end - session.startedAt)
}

/**
 * 세션이 구간과 겹치는 부분의 길이.
 * 자정을 넘는 세션을 "오늘" 통계에 넣을 때 오늘 몫만 세기 위한 것.
 */
export function sessionWorkedMsInRange(
  session: WorkSession,
  now: number,
  range: Range
): number {
  const start = Math.max(session.startedAt, range.from)
  const end = Math.min(session.endedAt ?? now, range.to)
  return Math.max(0, end - start)
}

function emptyStat(behaviorId: string): BehaviorStat {
  return { behaviorId, done: 0, snoozed: 0, skipped: 0, total: 0, rate: null }
}

function withRate(stat: BehaviorStat): BehaviorStat {
  return { ...stat, rate: stat.total === 0 ? null : stat.done / stat.total }
}

/**
 * 구간 통계.
 *
 * @param behaviorIds 표시 순서이자 **0건 행동도 행으로 남기기 위한 목록**.
 *                    설정에서 끈 행동을 빼고 싶으면 호출부에서 걸러서 넘긴다.
 */
export function computeStats(
  sessions: WorkSession[],
  logs: CompletionLog[],
  now: number,
  range: Range,
  behaviorIds: string[]
): Stats {
  let workedMs = 0
  let sessionCount = 0
  for (const session of sessions) {
    const overlap = sessionWorkedMsInRange(session, now, range)
    if (overlap <= 0) continue
    workedMs += overlap
    sessionCount += 1
  }

  const byId = new Map<string, BehaviorStat>()
  for (const id of behaviorIds) byId.set(id, emptyStat(id))

  for (const log of logs) {
    if (log.at < range.from || log.at >= range.to) continue
    // 목록에 없는 행동(프리셋에서 빠졌거나 과거 기록)도 버리지 않고 뒤에 붙인다
    let stat = byId.get(log.behaviorId)
    if (!stat) {
      stat = emptyStat(log.behaviorId)
      byId.set(log.behaviorId, stat)
    }
    stat[log.action] += 1
    stat.total += 1
  }

  const byBehavior = [...byId.values()].map(withRate)

  const overall = withRate(
    byBehavior.reduce(
      (acc, s) => ({
        ...acc,
        done: acc.done + s.done,
        snoozed: acc.snoozed + s.snoozed,
        skipped: acc.skipped + s.skipped,
        total: acc.total + s.total,
      }),
      emptyStat('__all__')
    )
  )

  return { workedMs, sessionCount, byBehavior, overall }
}

/** 세션 하나에 대한 종료 요약. 해당 세션의 로그만 넘겨야 한다. */
export function computeSessionSummary(
  session: WorkSession,
  logs: CompletionLog[],
  now: number,
  behaviorIds: string[]
): Stats {
  const range: Range = { from: session.startedAt, to: (session.endedAt ?? now) + 1 }
  return computeStats([session], logs, now, range, behaviorIds)
}
