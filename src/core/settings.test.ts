import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  applySettings,
  normalizeSettings,
} from './settings'
import { PRESET_BEHAVIORS } from './presets'
import type { AppSettings } from './settings'

const MIN = 60_000

function settingsWith(over: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, ...over }
}

const everyMs = (behaviors: ReturnType<typeof applySettings>, id: string) => {
  const rule = behaviors.find((b) => b.id === id)!.rule
  return rule.kind === 'interval' ? rule.everyMs : null
}

describe('DEFAULT_SETTINGS', () => {
  it('프리셋에서 그대로 유도된다', () => {
    expect(DEFAULT_SETTINGS.behaviors).toEqual([
      { behaviorId: 'stretch', enabled: true, everyMinutes: 50 },
      { behaviorId: 'water', enabled: true, everyMinutes: 30 },
      { behaviorId: 'eyes', enabled: true, everyMinutes: 60 },
    ])
  })
})

describe('applySettings', () => {
  it('enabled 를 덮어쓴다', () => {
    const settings = settingsWith({
      behaviors: DEFAULT_SETTINGS.behaviors.map((b) =>
        b.behaviorId === 'water' ? { ...b, enabled: false } : b
      ),
    })
    const applied = applySettings(PRESET_BEHAVIORS, settings)
    expect(applied.find((b) => b.id === 'water')!.enabled).toBe(false)
    expect(applied.find((b) => b.id === 'stretch')!.enabled).toBe(true)
  })

  it('간격(분)을 everyMs 로 반영한다', () => {
    const settings = settingsWith({
      behaviors: DEFAULT_SETTINGS.behaviors.map((b) =>
        b.behaviorId === 'water' ? { ...b, everyMinutes: 15 } : b
      ),
    })
    expect(everyMs(applySettings(PRESET_BEHAVIORS, settings), 'water')).toBe(15 * MIN)
  })

  it('범위 밖 간격은 프리셋 기본값으로 되돌린다', () => {
    for (const bad of [0, -5, MAX_INTERVAL_MINUTES + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const settings = settingsWith({
        behaviors: DEFAULT_SETTINGS.behaviors.map((b) =>
          b.behaviorId === 'water' ? { ...b, everyMinutes: bad } : b
        ),
      })
      expect(everyMs(applySettings(PRESET_BEHAVIORS, settings), 'water')).toBe(30 * MIN)
    }
  })

  it('경계값은 통과한다', () => {
    for (const ok of [MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES]) {
      const settings = settingsWith({
        behaviors: DEFAULT_SETTINGS.behaviors.map((b) =>
          b.behaviorId === 'water' ? { ...b, everyMinutes: ok } : b
        ),
      })
      expect(everyMs(applySettings(PRESET_BEHAVIORS, settings), 'water')).toBe(ok * MIN)
    }
  })

  it('설정에 없는 행동은 프리셋 그대로 둔다', () => {
    const settings = settingsWith({ behaviors: [] })
    expect(applySettings(PRESET_BEHAVIORS, settings)).toEqual(PRESET_BEHAVIORS)
  })

  it('원본 프리셋을 변형하지 않는다', () => {
    const before = JSON.stringify(PRESET_BEHAVIORS)
    applySettings(PRESET_BEHAVIORS, settingsWith({ behaviors: [] }))
    expect(JSON.stringify(PRESET_BEHAVIORS)).toBe(before)
  })
})

describe('normalizeSettings', () => {
  it('null 이면 기본값', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('빠진 행동을 프리셋으로 채운다', () => {
    const got = normalizeSettings({ behaviors: [{ behaviorId: 'water', enabled: false, everyMinutes: 10 }] })
    expect(got.behaviors).toHaveLength(3)
    expect(got.behaviors.find((b) => b.behaviorId === 'water')).toEqual({
      behaviorId: 'water',
      enabled: false,
      everyMinutes: 10,
    })
    expect(got.behaviors.find((b) => b.behaviorId === 'stretch')!.everyMinutes).toBe(50)
  })

  it('손상된 값은 기본값으로 되돌린다', () => {
    const got = normalizeSettings({
      behaviors: [{ behaviorId: 'water', enabled: 'yes' as unknown as boolean, everyMinutes: -1 }],
      idleReminderMinutes: 0,
      idleReminderEnabled: undefined,
    })
    expect(got.behaviors.find((b) => b.behaviorId === 'water')).toEqual({
      behaviorId: 'water',
      enabled: true,
      everyMinutes: 30,
    })
    expect(got.idleReminderMinutes).toBe(30)
    expect(got.idleReminderEnabled).toBe(true)
  })

  it('프리셋에 없는 저장 항목은 버린다', () => {
    const got = normalizeSettings({
      behaviors: [{ behaviorId: 'ghost', enabled: true, everyMinutes: 5 }],
    })
    expect(got.behaviors.map((b) => b.behaviorId)).toEqual(['stretch', 'water', 'eyes'])
  })
})
