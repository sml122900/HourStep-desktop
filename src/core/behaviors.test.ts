import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERVAL_MINUTES,
  FALLBACK_EMOJI,
  MAX_BEHAVIORS,
  MAX_INTERVAL_MINUTES,
  MAX_LABEL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MIN_INTERVAL_MINUTES,
  applyLegacyBehaviorSettings,
  cardMessage,
  clampIntervalMinutes,
  intervalMinutes,
  moveBehavior,
  newBehavior,
  normalizeBehavior,
  normalizeBehaviors,
  restoreBuiltins,
} from './behaviors'
import { SEED_BEHAVIORS, seedBehaviors } from './presets'
import type { Behavior } from './types'

const MIN = 60_000

const minutesOf = (list: Behavior[], id: string) => intervalMinutes(list.find((b) => b.id === id)!)

describe('seedBehaviors', () => {
  it('원본을 오염시키지 않는 사본을 준다', () => {
    const copy = seedBehaviors()
    copy[0].label = '변형됨'
    copy[0].rule = { kind: 'interval', everyMs: 1 }
    expect(SEED_BEHAVIORS[0].label).toBe('스트레칭')
    expect(intervalMinutes(SEED_BEHAVIORS[0])).toBe(50)
  })
})

describe('clampIntervalMinutes', () => {
  it('범위 밖은 가장 가까운 경계로 붙인다 (시드로 되돌리지 않는다)', () => {
    expect(clampIntervalMinutes(0)).toBe(MIN_INTERVAL_MINUTES)
    expect(clampIntervalMinutes(-5)).toBe(MIN_INTERVAL_MINUTES)
    expect(clampIntervalMinutes(MAX_INTERVAL_MINUTES + 1)).toBe(MAX_INTERVAL_MINUTES)
    expect(clampIntervalMinutes(99_999)).toBe(MAX_INTERVAL_MINUTES)
  })

  it('빈칸·숫자가 아닌 입력은 최소값으로 복구한다 (입력칸이 문자열을 넘긴다)', () => {
    for (const bad of ['', '   ', 'abc', null, undefined, Number.NaN]) {
      expect(clampIntervalMinutes(bad)).toBe(MIN_INTERVAL_MINUTES)
    }
  })

  it('경계값과 소수는 그대로 / 반올림해서 통과한다', () => {
    expect(clampIntervalMinutes(MIN_INTERVAL_MINUTES)).toBe(MIN_INTERVAL_MINUTES)
    expect(clampIntervalMinutes(MAX_INTERVAL_MINUTES)).toBe(MAX_INTERVAL_MINUTES)
    expect(clampIntervalMinutes('30')).toBe(30)
    expect(clampIntervalMinutes(29.6)).toBe(30)
  })
})

describe('normalizeBehavior', () => {
  it('간격이 범위 밖이면 같은 id 의 시드 값으로 되돌린다', () => {
    for (const bad of [0, -5, MAX_INTERVAL_MINUTES + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const got = normalizeBehaviors([
        { ...seedBehaviors()[1], rule: { kind: 'interval', everyMs: bad * MIN } },
      ])
      expect(minutesOf(got, 'water')).toBe(30)
    }
  })

  it('시드에 없는 행동은 기본 간격으로 되돌린다', () => {
    const got = normalizeBehavior({ id: 'custom', rule: { kind: 'interval', everyMs: -1 } })
    expect(intervalMinutes(got)).toBe(DEFAULT_INTERVAL_MINUTES)
  })

  it('경계값은 통과한다', () => {
    for (const ok of [MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES]) {
      const got = normalizeBehavior({ id: 'custom', rule: { kind: 'interval', everyMs: ok * MIN } })
      expect(intervalMinutes(got)).toBe(ok)
    }
  })

  it('이름·문구를 상한까지 자른다', () => {
    const got = normalizeBehavior({
      id: 'custom',
      label: '가'.repeat(MAX_LABEL_LENGTH + 10),
      message: '나'.repeat(MAX_MESSAGE_LENGTH + 10),
    })
    expect([...got.label]).toHaveLength(MAX_LABEL_LENGTH)
    expect([...got.message]).toHaveLength(MAX_MESSAGE_LENGTH)
  })

  it('이모지를 코드포인트 단위로 자른다 — 서로게이트 페어가 깨지면 안 된다', () => {
    const got = normalizeBehavior({ id: 'custom', emoji: '🧘💧👀⏰🔥🌊' })
    expect([...got.emoji]).toHaveLength(4)
    expect(got.emoji).toBe('🧘💧👀⏰')
    // 반쪽짜리 서로게이트가 남으면 U+FFFD 로 렌더된다
    expect(got.emoji).not.toContain('�')
  })

  it('빈 이름·이모지는 대체값으로 채운다', () => {
    const got = normalizeBehavior({ id: 'custom', label: '   ', emoji: '' })
    expect(got.emoji).toBe(FALLBACK_EMOJI)
    expect(got.label).not.toBe('')
  })

  it('isBuiltin 은 명시적 true 일 때만 붙는다', () => {
    expect(normalizeBehavior({ id: 'a' }).isBuiltin).toBe(false)
    expect(normalizeBehavior({ id: 'a', isBuiltin: 1 as never }).isBuiltin).toBe(false)
    expect(normalizeBehavior({ id: 'a', isBuiltin: true }).isBuiltin).toBe(true)
  })

  it('countdownMs 가 0 이하면 아예 넣지 않는다', () => {
    expect(normalizeBehavior({ id: 'a', countdownMs: 0 })).not.toHaveProperty('countdownMs')
    expect(normalizeBehavior({ id: 'a', countdownMs: 60_000 }).countdownMs).toBe(60_000)
  })

  it('atElapsed 규칙은 그대로 보존한다', () => {
    const got = normalizeBehavior({ id: 'once', rule: { kind: 'atElapsed', atMs: 90 * MIN } })
    expect(got.rule).toEqual({ kind: 'atElapsed', atMs: 90 * MIN })
  })
})

describe('normalizeBehaviors', () => {
  it('sortOrder 로 정렬하고 0부터 다시 매긴다', () => {
    const got = normalizeBehaviors([
      { id: 'c', sortOrder: 9 },
      { id: 'a', sortOrder: 2 },
      { id: 'b', sortOrder: 5 },
    ])
    expect(got.map((b) => b.id)).toEqual(['a', 'b', 'c'])
    expect(got.map((b) => b.sortOrder)).toEqual([0, 1, 2])
  })

  it('sortOrder 동점이면 들어온 순서를 지킨다', () => {
    const got = normalizeBehaviors([{ id: 'x' }, { id: 'y' }, { id: 'z' }])
    expect(got.map((b) => b.id)).toEqual(['x', 'y', 'z'])
  })

  it('id 가 비었거나 중복이면 버린다', () => {
    const got = normalizeBehaviors([{ id: 'a' }, { id: '' }, { id: 'a', label: '중복' }])
    expect(got.map((b) => b.id)).toEqual(['a'])
    expect(got[0].label).not.toBe('중복')
  })

  it('개수 상한에서 자른다', () => {
    const many = Array.from({ length: MAX_BEHAVIORS + 5 }, (_, i) => ({ id: `b${i}` }))
    expect(normalizeBehaviors(many)).toHaveLength(MAX_BEHAVIORS)
  })

  it('시드를 그대로 넣으면 시드가 그대로 나온다', () => {
    expect(normalizeBehaviors(seedBehaviors())).toEqual(seedBehaviors())
  })
})

describe('cardMessage', () => {
  it('문구가 비면 이름으로 대신한다', () => {
    const b = normalizeBehavior({ id: 'a', label: '물마시기', message: '  ' })
    expect(cardMessage(b)).toBe('물마시기')
  })

  it('문구가 있으면 문구를 쓴다', () => {
    expect(cardMessage(seedBehaviors()[1])).toBe('물 한 잔 마실 시간이에요')
  })
})

describe('newBehavior', () => {
  it('같은 밀리초에 두 번 만들어도 id 가 겹치지 않는다', () => {
    const first = newBehavior([], 1000)
    const second = newBehavior([first], 1000)
    expect(second.id).not.toBe(first.id)
  })

  it('내장 플래그 없이, 목록 끝에 붙는다', () => {
    const list = seedBehaviors()
    const created = newBehavior(list, 1000)
    expect(created.isBuiltin).toBe(false)
    expect(created.sortOrder).toBe(list.length)
    expect(intervalMinutes(created)).toBe(DEFAULT_INTERVAL_MINUTES)
  })
})

describe('moveBehavior', () => {
  it('한 칸 위로 옮기고 순서를 다시 매긴다', () => {
    const got = moveBehavior(seedBehaviors(), 'eyes', -1)
    expect(got.map((b) => b.id)).toEqual(['stretch', 'eyes', 'water'])
    expect(got.map((b) => b.sortOrder)).toEqual([0, 1, 2])
  })

  it('끝에서 더 움직이면 그대로', () => {
    const list = seedBehaviors()
    expect(moveBehavior(list, 'stretch', -1)).toBe(list)
    expect(moveBehavior(list, 'eyes', 1)).toBe(list)
    expect(moveBehavior(list, 'ghost', 1)).toBe(list)
  })
})

describe('restoreBuiltins', () => {
  it('편집·삭제된 내장 3종을 시드 값으로 되돌린다', () => {
    const wrecked = [
      {
        ...seedBehaviors()[0],
        label: '망가짐',
        enabled: false,
        rule: { kind: 'interval' as const, everyMs: 3 * MIN },
      },
      // water 는 아예 지워진 상태
      seedBehaviors()[2],
    ]
    const got = restoreBuiltins(wrecked)
    expect(got.filter((b) => b.isBuiltin).map((b) => b.id)).toEqual(['stretch', 'water', 'eyes'])
    expect(got.find((b) => b.id === 'stretch')).toEqual(seedBehaviors()[0])
  })

  it('사용자가 만든 행동은 남긴다 — 복원이 전부 지우기가 되면 안 된다', () => {
    const custom = newBehavior(seedBehaviors(), 1000)
    const got = restoreBuiltins([custom])
    expect(got.map((b) => b.id)).toEqual(['stretch', 'water', 'eyes', custom.id])
  })
})

describe('applyLegacyBehaviorSettings', () => {
  it('D2 설정의 on/off·간격을 시드에 덧씌운다', () => {
    const got = applyLegacyBehaviorSettings(seedBehaviors(), [
      { behaviorId: 'water', enabled: false, everyMinutes: 10 },
    ])
    expect(got.find((b) => b.id === 'water')!.enabled).toBe(false)
    expect(minutesOf(got, 'water')).toBe(10)
    expect(minutesOf(got, 'stretch')).toBe(50)
  })

  it('범위 밖 간격은 시드 값으로 되돌린다', () => {
    const got = applyLegacyBehaviorSettings(seedBehaviors(), [
      { behaviorId: 'eyes', enabled: true, everyMinutes: Number.NaN },
    ])
    expect(minutesOf(got, 'eyes')).toBe(60)
  })

  it('모르는 id 는 무시한다', () => {
    const got = applyLegacyBehaviorSettings(seedBehaviors(), [
      { behaviorId: 'ghost', enabled: true, everyMinutes: 5 },
    ])
    expect(got.map((b) => b.id)).toEqual(['stretch', 'water', 'eyes'])
  })

  it('레거시가 없으면 시드 그대로', () => {
    expect(applyLegacyBehaviorSettings(seedBehaviors(), null)).toEqual(seedBehaviors())
  })
})
