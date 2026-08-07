/**
 * 사용자 설정 → Behavior 반영 — IO 없는 순수 모듈. React·Tauri import 금지.
 * 저장/로드는 `src/data/` 어댑터 담당.
 */

import { PRESET_BEHAVIORS } from './presets'
import type { Behavior } from './types'

const MIN = 60_000

/** 간격 허용 범위. 밖의 값은 프리셋 기본값으로 되돌린다 (설정 창은 신뢰 경계다) */
export const MIN_INTERVAL_MINUTES = 1
export const MAX_INTERVAL_MINUTES = 8 * 60

export const MIN_IDLE_REMINDER_MINUTES = 1
export const MAX_IDLE_REMINDER_MINUTES = 8 * 60

export interface BehaviorSetting {
  behaviorId: string
  enabled: boolean
  everyMinutes: number
}

export interface AppSettings {
  behaviors: BehaviorSetting[]
  /** 세션 미시작 리마인더 */
  idleReminderEnabled: boolean
  idleReminderMinutes: number
}

function presetMinutes(behavior: Behavior): number {
  return behavior.rule.kind === 'interval' ? Math.round(behavior.rule.everyMs / MIN) : 0
}

export const DEFAULT_SETTINGS: AppSettings = {
  behaviors: PRESET_BEHAVIORS.map((b) => ({
    behaviorId: b.id,
    enabled: b.enabled,
    everyMinutes: presetMinutes(b),
  })),
  idleReminderEnabled: true,
  idleReminderMinutes: 30,
}

function clampMinutes(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  if (rounded < min || rounded > max) return fallback
  return rounded
}

/**
 * 프리셋에 설정을 덧씌운 Behavior 목록.
 * 설정에 없는 행동은 프리셋 그대로 두고, 프리셋에 없는 설정은 무시한다.
 */
export function applySettings(presets: Behavior[], settings: AppSettings): Behavior[] {
  const byId = new Map(settings.behaviors.map((s) => [s.behaviorId, s]))

  return presets.map((behavior) => {
    const setting = byId.get(behavior.id)
    if (!setting) return behavior

    const next: Behavior = { ...behavior, enabled: setting.enabled }

    if (behavior.rule.kind === 'interval') {
      const minutes = clampMinutes(
        setting.everyMinutes,
        presetMinutes(behavior),
        MIN_INTERVAL_MINUTES,
        MAX_INTERVAL_MINUTES
      )
      next.rule = { kind: 'interval', everyMs: minutes * MIN }
    }

    return next
  })
}

/** 저장돼 있던 값을 신뢰 가능한 범위로 정규화한다 (DB 가 손상됐거나 구버전일 수 있다) */
export function normalizeSettings(partial: Partial<AppSettings> | null | undefined): AppSettings {
  if (!partial) return DEFAULT_SETTINGS

  const behaviors = PRESET_BEHAVIORS.map((preset) => {
    const saved = partial.behaviors?.find((s) => s.behaviorId === preset.id)
    const fallback = presetMinutes(preset)
    return {
      behaviorId: preset.id,
      enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : preset.enabled,
      everyMinutes: clampMinutes(
        saved?.everyMinutes ?? fallback,
        fallback,
        MIN_INTERVAL_MINUTES,
        MAX_INTERVAL_MINUTES
      ),
    }
  })

  return {
    behaviors,
    idleReminderEnabled:
      typeof partial.idleReminderEnabled === 'boolean'
        ? partial.idleReminderEnabled
        : DEFAULT_SETTINGS.idleReminderEnabled,
    idleReminderMinutes: clampMinutes(
      partial.idleReminderMinutes ?? DEFAULT_SETTINGS.idleReminderMinutes,
      DEFAULT_SETTINGS.idleReminderMinutes,
      MIN_IDLE_REMINDER_MINUTES,
      MAX_IDLE_REMINDER_MINUTES
    ),
  }
}
