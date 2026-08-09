import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  MAX_IDLE_REMINDER_MINUTES,
  MAX_SOUND_VOLUME,
  MIN_IDLE_REMINDER_MINUTES,
  MIN_SOUND_VOLUME,
  clampIdleReminderMinutes,
  extractLegacyBehaviors,
  normalizeSettings,
} from './settings'

/**
 * 리마인더 간격칸도 D2.8 부터 행동의 간격칸과 같은 컴포넌트(NumberField)를 쓴다.
 * `normalizeSettings` 는 손상된 값을 **기본값으로 되돌리지만** 입력 중인 값은 경계로 붙인다.
 */
describe('clampIdleReminderMinutes', () => {
  it('범위 밖은 가까운 경계로 붙인다 (기본값으로 되돌리지 않는다)', () => {
    expect(clampIdleReminderMinutes(0)).toBe(MIN_IDLE_REMINDER_MINUTES)
    expect(clampIdleReminderMinutes(-5)).toBe(MIN_IDLE_REMINDER_MINUTES)
    expect(clampIdleReminderMinutes(MAX_IDLE_REMINDER_MINUTES + 1)).toBe(MAX_IDLE_REMINDER_MINUTES)
    expect(clampIdleReminderMinutes(99_999)).toBe(MAX_IDLE_REMINDER_MINUTES)
  })

  it('빈칸·숫자 아님은 최솟값', () => {
    for (const bad of ['', ' ', 'abc', null, undefined, Number.NaN]) {
      expect(clampIdleReminderMinutes(bad)).toBe(MIN_IDLE_REMINDER_MINUTES)
    }
  })

  it('경계값과 소수는 그대로 / 반올림해서 통과한다', () => {
    expect(clampIdleReminderMinutes(MIN_IDLE_REMINDER_MINUTES)).toBe(MIN_IDLE_REMINDER_MINUTES)
    expect(clampIdleReminderMinutes(MAX_IDLE_REMINDER_MINUTES)).toBe(MAX_IDLE_REMINDER_MINUTES)
    expect(clampIdleReminderMinutes('30')).toBe(30)
    expect(clampIdleReminderMinutes(29.6)).toBe(30)
  })
})

describe('normalizeSettings', () => {
  it('null 이면 기본값', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('손상된 값은 기본값으로 되돌린다', () => {
    const got = normalizeSettings({
      idleReminderMinutes: 0,
      idleReminderEnabled: undefined,
      theme: 'neon' as never,
    })
    expect(got).toEqual(DEFAULT_SETTINGS)
  })

  it('리마인더 간격 경계값은 통과한다', () => {
    for (const ok of [MIN_IDLE_REMINDER_MINUTES, MAX_IDLE_REMINDER_MINUTES]) {
      expect(normalizeSettings({ idleReminderMinutes: ok }).idleReminderMinutes).toBe(ok)
    }
    expect(
      normalizeSettings({ idleReminderMinutes: MAX_IDLE_REMINDER_MINUTES + 1 }).idleReminderMinutes
    ).toBe(DEFAULT_SETTINGS.idleReminderMinutes)
  })

  it('알림음 볼륨 경계값은 통과하고, 범위 밖은 기본값으로 되돌린다', () => {
    for (const ok of [MIN_SOUND_VOLUME, MAX_SOUND_VOLUME, 35]) {
      expect(normalizeSettings({ soundVolume: ok }).soundVolume).toBe(ok)
    }
    for (const bad of [-1, MAX_SOUND_VOLUME + 1, Number.NaN]) {
      expect(normalizeSettings({ soundVolume: bad }).soundVolume).toBe(DEFAULT_SETTINGS.soundVolume)
    }
  })

  it('알림음은 기본으로 켜져 있고, 명시적 false 만 끈다', () => {
    expect(DEFAULT_SETTINGS.soundEnabled).toBe(true)
    expect(normalizeSettings({ soundEnabled: false }).soundEnabled).toBe(false)
    expect(normalizeSettings({ soundEnabled: 0 as never }).soundEnabled).toBe(true)
  })

  it('테마 3택을 보존한다', () => {
    for (const theme of ['system', 'light', 'dark'] as const) {
      expect(normalizeSettings({ theme }).theme).toBe(theme)
    }
  })

  it('D2 의 behaviors 필드는 버린다 — 저장하면 자동으로 사라진다', () => {
    const got = normalizeSettings({
      behaviors: [{ behaviorId: 'water', enabled: false, everyMinutes: 10 }],
    } as never)
    expect(got).not.toHaveProperty('behaviors')
  })
})

describe('extractLegacyBehaviors', () => {
  it('D2 설정 JSON 에서 행동 설정을 건진다', () => {
    expect(
      extractLegacyBehaviors({
        idleReminderEnabled: true,
        behaviors: [{ behaviorId: 'water', enabled: false, everyMinutes: 10 }],
      })
    ).toEqual([{ behaviorId: 'water', enabled: false, everyMinutes: 10 }])
  })

  it('필드가 없거나 형태가 어긋나면 null', () => {
    expect(extractLegacyBehaviors(null)).toBeNull()
    expect(extractLegacyBehaviors({})).toBeNull()
    expect(extractLegacyBehaviors({ behaviors: 'nope' })).toBeNull()
    expect(extractLegacyBehaviors({ behaviors: [] })).toBeNull()
    expect(extractLegacyBehaviors({ behaviors: [{ enabled: true }] })).toBeNull()
  })

  it('id 없는 항목만 걸러내고 나머지는 살린다', () => {
    const got = extractLegacyBehaviors({
      behaviors: [{ behaviorId: '' }, { behaviorId: 'eyes', everyMinutes: 90 }],
    })
    expect(got).toEqual([{ behaviorId: 'eyes', enabled: true, everyMinutes: 90 }])
  })
})
