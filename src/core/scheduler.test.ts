import { describe, expect, it } from 'vitest'
import { MERGE_WINDOW_MS, SNOOZE_MS, computeNextOccurrences, occurrenceId } from './scheduler'
import type { Behavior, Occurrence, WorkSession } from './types'

const MIN = 60_000
const HOUR = 60 * MIN

/** 2026-08-07 22:00 KST — 자정을 넘기는 세션 테스트에 쓴다 */
const T0 = Date.UTC(2026, 7, 7, 13, 0, 0)

function session(over: Partial<WorkSession> = {}): WorkSession {
  return { id: 's1', startedAt: T0, endedAt: null, ...over }
}

function behavior(over: Partial<Behavior> = {}): Behavior {
  return {
    id: 'water',
    label: '물마시기',
    emoji: '💧',
    message: '물 한 잔 마실 시간이에요',
    rule: { kind: 'interval', everyMs: 30 * MIN },
    intensity: 'card',
    enabled: true,
    isBuiltin: true,
    sortOrder: 0,
    ...over,
  }
}

const dueOffsets = (occurrences: Occurrence[]) => occurrences.map((o) => (o.dueAt - T0) / MIN)

describe('computeNextOccurrences', () => {
  it('interval 은 세션 시작 + everyMs 부터, 0분에는 발화하지 않는다', () => {
    const got = computeNextOccurrences(session(), [behavior()], T0, 2 * HOUR)
    expect(dueOffsets(got)).toEqual([30, 60, 90, 120])
  })

  it('dueAt 오름차순으로 정렬한다 (행동이 섞여도)', () => {
    const behaviors = [
      behavior({ id: 'eyes', rule: { kind: 'interval', everyMs: 60 * MIN } }),
      behavior({ id: 'water', rule: { kind: 'interval', everyMs: 30 * MIN } }),
    ]
    const got = computeNextOccurrences(session(), behaviors, T0, 70 * MIN)
    expect(dueOffsets(got)).toEqual([30, 60, 60])
  })

  it('now 가 세션 도중이면 이미 지난 occurrence 를 제외한다', () => {
    const now = T0 + 70 * MIN
    const got = computeNextOccurrences(session(), [behavior()], now, HOUR)
    // 30분·60분 것은 지났다. 90분·120분만 남는다.
    expect(dueOffsets(got)).toEqual([90, 120])
  })

  it('now 와 정확히 같은 시각의 occurrence 는 포함한다 (경계)', () => {
    const now = T0 + 30 * MIN
    const got = computeNextOccurrences(session(), [behavior()], now, 0)
    expect(dueOffsets(got)).toEqual([30])
  })

  it('enabled:false 행동은 제외한다', () => {
    const behaviors = [behavior({ id: 'water', enabled: false }), behavior({ id: 'eyes' })]
    const got = computeNextOccurrences(session(), behaviors, T0, HOUR)
    expect(got.every((o) => o.behaviorId === 'eyes')).toBe(true)
  })

  it('horizon 밖은 제외한다', () => {
    const got = computeNextOccurrences(session(), [behavior()], T0, 45 * MIN)
    expect(dueOffsets(got)).toEqual([30])
  })

  it('종료된 세션은 빈 배열', () => {
    const ended = session({ endedAt: T0 + HOUR })
    expect(computeNextOccurrences(ended, [behavior()], T0, 10 * HOUR)).toEqual([])
  })

  it('atElapsed 는 경과 시점 1회만 낸다', () => {
    const b = behavior({ id: 'once', rule: { kind: 'atElapsed', atMs: 90 * MIN } })
    expect(dueOffsets(computeNextOccurrences(session(), [b], T0, 3 * HOUR))).toEqual([90])
    expect(computeNextOccurrences(session(), [b], T0 + 2 * HOUR, HOUR)).toEqual([])
  })

  it('자정을 넘는 세션도 경과시간 기준으로만 계산한다 (벽시계 무관)', () => {
    // T0 = 22:00 KST. 4시간 세션이면 자정을 넘긴다.
    const got = computeNextOccurrences(session(), [behavior()], T0, 4 * HOUR)
    expect(dueOffsets(got)).toEqual([30, 60, 90, 120, 150, 180, 210, 240])

    // 시작 시각만 12시간 옮겨도(=자정을 안 넘김) 오프셋 결과가 동일해야 한다
    const noon = session({ startedAt: T0 + 12 * HOUR })
    const shifted = computeNextOccurrences(noon, [behavior()], noon.startedAt, 4 * HOUR)
    expect(shifted.map((o) => o.dueAt - noon.startedAt)).toEqual(got.map((o) => o.dueAt - T0))
  })

  describe('스누즈', () => {
    it('스누즈를 3분 뒤 단발 occurrence 로 재삽입한다', () => {
      const now = T0 + 31 * MIN
      const snooze: Occurrence = { behaviorId: 'water', dueAt: now + SNOOZE_MS, origin: 'snooze' }
      const got = computeNextOccurrences(session(), [behavior()], now, 20 * MIN, [snooze])
      expect(got).toContainEqual(snooze)
      expect(dueOffsets(got)).toEqual([34])
    })

    it('다음 정규 알림과 5분 이내로 겹치면 정규 것만 남긴다', () => {
      // 57분에 스누즈 → 60분. 정규 60분과 겹친다.
      const now = T0 + 57 * MIN
      const snooze: Occurrence = { behaviorId: 'water', dueAt: now + SNOOZE_MS, origin: 'snooze' }
      const got = computeNextOccurrences(session(), [behavior()], now, 30 * MIN, [snooze])
      // 스누즈 dueAt(60분) 은 조회 구간 안에 있는데도 사라졌다 = 병합된 것
      expect(got.filter((o) => o.origin === 'snooze')).toEqual([])
      expect(dueOffsets(got)).toEqual([60])
    })

    it('경계: 정확히 5분 차이면 병합, 5분 초과면 유지', () => {
      const now = T0 + 31 * MIN
      const merged: Occurrence = {
        behaviorId: 'water',
        dueAt: T0 + 60 * MIN - MERGE_WINDOW_MS,
        origin: 'snooze',
      }
      const kept: Occurrence = {
        behaviorId: 'water',
        dueAt: T0 + 60 * MIN - MERGE_WINDOW_MS - 1,
        origin: 'snooze',
      }
      const withMerged = computeNextOccurrences(session(), [behavior()], now, HOUR, [merged])
      const withKept = computeNextOccurrences(session(), [behavior()], now, HOUR, [kept])
      expect(withMerged.some((o) => o.origin === 'snooze')).toBe(false)
      expect(withKept.some((o) => o.origin === 'snooze')).toBe(true)
    })

    it('이미 지나간 정규 알림과 겹치는 것은 병합하지 않는다 (뒤쪽만 본다)', () => {
      // 30분 알림을 받고 바로 스누즈 → 33분. 방금 지나간 30분 것과 3분 차이지만
      // 그걸 병합으로 치면 스누즈가 통째로 사라진다.
      const now = T0 + 30 * MIN
      const snooze: Occurrence = { behaviorId: 'water', dueAt: now + SNOOZE_MS, origin: 'snooze' }
      const got = computeNextOccurrences(session(), [behavior()], T0, 33 * MIN, [snooze])
      expect(got.some((o) => o.origin === 'snooze')).toBe(true)
      expect(dueOffsets(got)).toEqual([30, 33])
    })

    it('다른 행동의 정규 알림과 겹치는 것은 병합하지 않는다', () => {
      const now = T0 + 57 * MIN
      const snooze: Occurrence = { behaviorId: 'eyes', dueAt: T0 + 60 * MIN, origin: 'snooze' }
      const got = computeNextOccurrences(session(), [behavior()], now, 30 * MIN, [snooze])
      expect(got.some((o) => o.origin === 'snooze')).toBe(true)
    })
  })

  it('everyMs 가 0 이하면 폭주하지 않고 무시한다', () => {
    const broken = behavior({ rule: { kind: 'interval', everyMs: 0 } })
    expect(computeNextOccurrences(session(), [broken], T0, 10 * HOUR)).toEqual([])
  })
})

describe('occurrenceId', () => {
  it('같은 (행동, 예정시각) 이면 같은 id', () => {
    const a: Occurrence = { behaviorId: 'water', dueAt: T0, origin: 'regular' }
    const b: Occurrence = { behaviorId: 'water', dueAt: T0, origin: 'snooze' }
    expect(occurrenceId(a)).toBe(occurrenceId(b))
  })
})
