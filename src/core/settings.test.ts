import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  MAX_IDLE_REMINDER_MINUTES,
  MIN_IDLE_REMINDER_MINUTES,
  extractLegacyBehaviors,
  normalizeSettings,
} from './settings'

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
