/**
 * 앱 설정 — IO 없는 순수 모듈. React·Tauri import 금지.
 * 저장/로드는 `src/data/` 어댑터 담당.
 *
 * D2.5 부터 **행동은 여기 없다.** behaviors 테이블이 단일 출처다 (`src/core/behaviors.ts`).
 * 여기 남은 건 행동에 속하지 않는 앱 전역 설정뿐이다.
 */

import type { LegacyBehaviorSetting } from './behaviors'
import { DEFAULT_THEME, normalizeThemePreference, type ThemePreference } from './theme'

export const MIN_IDLE_REMINDER_MINUTES = 1
export const MAX_IDLE_REMINDER_MINUTES = 8 * 60

export interface AppSettings {
  /** 세션 미시작 리마인더 */
  idleReminderEnabled: boolean
  idleReminderMinutes: number
  theme: ThemePreference
}

export const DEFAULT_SETTINGS: AppSettings = {
  idleReminderEnabled: true,
  idleReminderMinutes: 30,
  theme: DEFAULT_THEME,
}

function clampMinutes(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  if (rounded < min || rounded > max) return fallback
  return rounded
}

/** 저장돼 있던 값을 신뢰 가능한 범위로 정규화한다 (DB 가 손상됐거나 구버전일 수 있다) */
export function normalizeSettings(partial: Partial<AppSettings> | null | undefined): AppSettings {
  if (!partial) return DEFAULT_SETTINGS

  return {
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
    theme: normalizeThemePreference(partial.theme),
  }
}

/**
 * D2 설정 JSON 에 들어 있던 `behaviors` 배열을 꺼낸다.
 *
 * `normalizeSettings` 는 이 필드를 버리므로(= 저장할 때 자동으로 사라진다), v2 로 올라오는
 * 딱 한 번 어댑터가 이 함수로 값을 건져 behaviors 테이블 시드에 덧씌운다.
 * 형태가 조금이라도 어긋나면 null — 없는 셈 치고 시드 기본값으로 간다.
 */
export function extractLegacyBehaviors(parsed: unknown): LegacyBehaviorSetting[] | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const raw = (parsed as { behaviors?: unknown }).behaviors
  if (!Array.isArray(raw)) return null

  const out: LegacyBehaviorSetting[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const { behaviorId, enabled, everyMinutes } = item as Partial<LegacyBehaviorSetting>
    if (typeof behaviorId !== 'string' || behaviorId === '') continue
    out.push({
      behaviorId,
      enabled: typeof enabled === 'boolean' ? enabled : true,
      everyMinutes: Number(everyMinutes),
    })
  }
  return out.length > 0 ? out : null
}
