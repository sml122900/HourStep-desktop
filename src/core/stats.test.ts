import { describe, expect, it } from 'vitest'
import { computeSessionSummary, computeStats, sessionWorkedMs, sessionWorkedMsInRange } from './stats'
import type { CompletionLog, WorkSession } from './types'

const MIN = 60_000
const HOUR = 60 * MIN

/** 2026-08-07 09:00 KST */
const DAY_START = Date.UTC(2026, 7, 6, 15, 0, 0) // 08-07 00:00 KST
const T9 = DAY_START + 9 * HOUR

const IDS = ['stretch', 'water', 'eyes']
const today = { from: DAY_START, to: DAY_START + 24 * HOUR }

function session(id: string, startedAt: number, endedAt: number | null): WorkSession {
  return { id, startedAt, endedAt }
}

function log(behaviorId: string, action: CompletionLog['action'], at: number): CompletionLog {
  return { occurrenceId: `${behaviorId}@${at}`, behaviorId, action, at }
}

describe('sessionWorkedMs', () => {
  it('종료된 세션은 startedAt~endedAt', () => {
    expect(sessionWorkedMs(session('a', T9, T9 + 2 * HOUR), T9 + 5 * HOUR)).toBe(2 * HOUR)
  })

  it('진행 중인 세션은 now 까지', () => {
    expect(sessionWorkedMs(session('a', T9, null), T9 + 90 * MIN)).toBe(90 * MIN)
  })

  it('음수가 나오지 않는다 (now 가 시작 전이어도)', () => {
    expect(sessionWorkedMs(session('a', T9, null), T9 - HOUR)).toBe(0)
  })
})

describe('sessionWorkedMsInRange', () => {
  it('구간 안에 완전히 들어가면 전체 길이', () => {
    const s = session('a', T9, T9 + 2 * HOUR)
    expect(sessionWorkedMsInRange(s, T9 + 3 * HOUR, today)).toBe(2 * HOUR)
  })

  it('자정을 넘는 세션은 구간과 겹치는 부분만 센다', () => {
    // 어제 23:00 ~ 오늘 02:00 (3시간) 중 오늘 몫은 2시간
    const s = session('a', DAY_START - HOUR, DAY_START + 2 * HOUR)
    expect(sessionWorkedMsInRange(s, DAY_START + 5 * HOUR, today)).toBe(2 * HOUR)
  })

  it('구간과 안 겹치면 0', () => {
    const s = session('a', DAY_START - 5 * HOUR, DAY_START - 2 * HOUR)
    expect(sessionWorkedMsInRange(s, DAY_START, today)).toBe(0)
  })
})

describe('computeStats', () => {
  it('데이터 0건이면 행동별 행은 남고 rate 는 null', () => {
    const stats = computeStats([], [], T9, today, IDS)
    expect(stats.workedMs).toBe(0)
    expect(stats.sessionCount).toBe(0)
    expect(stats.byBehavior.map((s) => s.behaviorId)).toEqual(IDS)
    expect(stats.byBehavior.every((s) => s.rate === null && s.total === 0)).toBe(true)
    expect(stats.overall.rate).toBeNull()
  })

  it('rate 는 done / (done+snoozed+skipped)', () => {
    const logs = [
      log('water', 'done', T9 + 30 * MIN),
      log('water', 'done', T9 + 60 * MIN),
      log('water', 'snoozed', T9 + 90 * MIN),
      log('water', 'skipped', T9 + 120 * MIN),
    ]
    const water = computeStats([], logs, T9, today, IDS).byBehavior.find(
      (s) => s.behaviorId === 'water'
    )!
    expect(water).toMatchObject({ done: 2, snoozed: 1, skipped: 1, total: 4 })
    expect(water.rate).toBe(0.5)
  })

  it('rate 0% 와 기록 없음(null)을 구분한다', () => {
    const logs = [log('eyes', 'skipped', T9)]
    const stats = computeStats([], logs, T9, today, IDS)
    expect(stats.byBehavior.find((s) => s.behaviorId === 'eyes')!.rate).toBe(0)
    expect(stats.byBehavior.find((s) => s.behaviorId === 'water')!.rate).toBeNull()
  })

  it('구간 밖 로그는 제외한다 (to 는 미포함)', () => {
    const logs = [
      log('water', 'done', today.from - 1),
      log('water', 'done', today.from),
      log('water', 'done', today.to - 1),
      log('water', 'done', today.to),
    ]
    const water = computeStats([], logs, T9, today, IDS).byBehavior.find(
      (s) => s.behaviorId === 'water'
    )!
    expect(water.total).toBe(2)
  })

  it('행동 목록에 없는 로그도 버리지 않고 뒤에 붙인다', () => {
    const logs = [log('legacy', 'done', T9)]
    const stats = computeStats([], logs, T9, today, IDS)
    expect(stats.byBehavior.map((s) => s.behaviorId)).toEqual([...IDS, 'legacy'])
    expect(stats.overall.total).toBe(1)
  })

  it('overall 은 행동별 합계', () => {
    const logs = [
      log('water', 'done', T9),
      log('stretch', 'done', T9),
      log('eyes', 'skipped', T9),
    ]
    const stats = computeStats([], logs, T9, today, IDS)
    expect(stats.overall).toMatchObject({ done: 2, skipped: 1, total: 3 })
    expect(stats.overall.rate).toBeCloseTo(2 / 3)
  })

  it('여러 세션의 작업시간을 합치고 세션 수를 센다', () => {
    const sessions = [
      session('a', T9, T9 + HOUR),
      session('b', T9 + 2 * HOUR, T9 + 3 * HOUR),
      session('c', DAY_START - 5 * HOUR, DAY_START - 4 * HOUR), // 어제 — 제외
    ]
    const stats = computeStats(sessions, [], T9 + 4 * HOUR, today, IDS)
    expect(stats.workedMs).toBe(2 * HOUR)
    expect(stats.sessionCount).toBe(2)
  })

  it('진행 중인 세션도 now 까지 작업시간에 포함한다', () => {
    const stats = computeStats([session('a', T9, null)], [], T9 + 45 * MIN, today, IDS)
    expect(stats.workedMs).toBe(45 * MIN)
    expect(stats.sessionCount).toBe(1)
  })
})

describe('computeSessionSummary', () => {
  it('세션 경계를 구간으로 삼는다 — 마지막 순간의 로그도 포함', () => {
    const s = session('a', T9, T9 + HOUR)
    const logs = [
      log('water', 'done', T9), // 시작 시각
      log('water', 'done', T9 + HOUR), // 종료 시각 — to 가 exclusive 라 놓치기 쉬운 자리
      log('water', 'done', T9 + 2 * HOUR), // 세션 밖
    ]
    const summary = computeSessionSummary(s, logs, T9 + 3 * HOUR, IDS)
    expect(summary.workedMs).toBe(HOUR)
    expect(summary.byBehavior.find((b) => b.behaviorId === 'water')!.total).toBe(2)
  })
})
