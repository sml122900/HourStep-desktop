import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERVAL_MINUTES,
  FALLBACK_EMOJI,
  MAX_BEHAVIORS,
  MAX_DURATION_SEC,
  MAX_INTERVAL_MINUTES,
  MAX_LABEL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MIN_DURATION_SEC,
  MIN_INTERVAL_MINUTES,
  applyLegacyBehaviorSettings,
  cardMessage,
  clampDurationSeconds,
  clampIntervalMinutes,
  intervalMinutes,
  moveBehavior,
  newBehavior,
  normalizeBehavior,
  normalizeBehaviors,
  restoreBuiltins,
  sanitizeDigits,
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

  it('행위 시간 시드 — 스트레칭 60초 / 물 0초(즉시) / 눈휴식 60초', () => {
    expect(seedBehaviors().map((b) => [b.id, b.durationSec])).toEqual([
      ['stretch', 60],
      ['water', 0],
      ['eyes', 60],
    ])
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

describe('clampDurationSeconds', () => {
  it('0 은 유효한 값이다 — 「즉시 행동」이지 값 없음이 아니다', () => {
    expect(clampDurationSeconds(0)).toBe(0)
    expect(clampDurationSeconds('0')).toBe(0)
  })

  it('범위 밖은 가장 가까운 경계로 붙인다', () => {
    expect(clampDurationSeconds(-1)).toBe(MIN_DURATION_SEC)
    expect(clampDurationSeconds(MAX_DURATION_SEC + 1)).toBe(MAX_DURATION_SEC)
    expect(clampDurationSeconds(99_999)).toBe(MAX_DURATION_SEC)
  })

  it('빈칸·숫자가 아닌 입력은 0 으로 (입력칸이 문자열을 넘긴다)', () => {
    for (const bad of ['', '   ', 'abc', null, undefined, Number.NaN]) {
      expect(clampDurationSeconds(bad)).toBe(0)
    }
  })

  it('경계값과 소수는 그대로 / 반올림해서 통과한다', () => {
    expect(clampDurationSeconds(MIN_DURATION_SEC)).toBe(MIN_DURATION_SEC)
    expect(clampDurationSeconds(MAX_DURATION_SEC)).toBe(MAX_DURATION_SEC)
    expect(clampDurationSeconds('60')).toBe(60)
    expect(clampDurationSeconds(59.6)).toBe(60)
  })
})

/**
 * 숫자칸(`src/components/NumberField.tsx`)이 타이핑 도중 쓰는 정리 함수.
 * 여기가 무너지면 「지우는 중인데 값이 바뀐다」가 되돌아온다.
 */
describe('sanitizeDigits', () => {
  it('빈칸을 빈칸으로 돌려준다 — 0 으로 확정하지 않는다', () => {
    expect(sanitizeDigits('')).toBe('')
    // 마지막 글자를 지우는 순간이 이 경로다. '' 이 0 이 되면 값이 시드로 튄다
    expect(sanitizeDigits('5'.slice(0, 0))).toBe('')
  })

  it('숫자가 아닌 글자를 버린다', () => {
    expect(sanitizeDigits('3a0')).toBe('30')
    expect(sanitizeDigits('-5')).toBe('5')
    expect(sanitizeDigits('1.5')).toBe('15')
    expect(sanitizeDigits('e')).toBe('')
    expect(sanitizeDigits('삼십')).toBe('')
  })

  it('선행 0 을 지운다 — 뒤에 숫자가 있을 때만', () => {
    expect(sanitizeDigits('030')).toBe('30')
    expect(sanitizeDigits('0001')).toBe('1')
    expect(sanitizeDigits('0')).toBe('0') // 행위 시간 0초는 유효한 값이다
    expect(sanitizeDigits('000')).toBe('0')
  })

  it('경계값은 그대로 통과한다', () => {
    for (const raw of ['0', '1', '480', '600']) expect(sanitizeDigits(raw)).toBe(raw)
  })

  it('정리한 문자열을 clamp 에 넘기면 최종값이 범위 안에 든다', () => {
    // NumberField 가 blur 에서 실제로 하는 두 단계 (정리 → 복구)
    expect(clampIntervalMinutes(sanitizeDigits(''))).toBe(MIN_INTERVAL_MINUTES)
    expect(clampIntervalMinutes(sanitizeDigits('030'))).toBe(30)
    expect(clampIntervalMinutes(sanitizeDigits('600'))).toBe(MAX_INTERVAL_MINUTES)
    expect(clampDurationSeconds(sanitizeDigits(''))).toBe(MIN_DURATION_SEC)
    expect(clampDurationSeconds(sanitizeDigits('0'))).toBe(0)
    expect(clampDurationSeconds(sanitizeDigits('9999'))).toBe(MAX_DURATION_SEC)
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

  it('행위 시간이 없으면 0(즉시 행동) — 시드 값으로 되돌리지 않는다', () => {
    expect(normalizeBehavior({ id: 'a' }).durationSec).toBe(0)
    // 사용자가 스트레칭을 즉시 행동으로 바꿔 뒀다면 그 선택이 살아남아야 한다
    expect(normalizeBehavior({ ...seedBehaviors()[0], durationSec: 0 }).durationSec).toBe(0)
  })

  it('행위 시간은 경계 안으로 밀어 넣는다', () => {
    expect(normalizeBehavior({ id: 'a', durationSec: -30 }).durationSec).toBe(MIN_DURATION_SEC)
    expect(normalizeBehavior({ id: 'a', durationSec: 99_999 }).durationSec).toBe(MAX_DURATION_SEC)
    expect(normalizeBehavior({ id: 'a', durationSec: 60 }).durationSec).toBe(60)
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
