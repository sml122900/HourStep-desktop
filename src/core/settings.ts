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

/** 알림음 볼륨은 백분율 정수로 저장한다. 부동소수를 DB·JSON 에 왕복시키지 않기 위해서. */
export const MIN_SOUND_VOLUME = 0
export const MAX_SOUND_VOLUME = 100

export interface AppSettings {
  /** 세션 미시작 리마인더 */
  idleReminderEnabled: boolean
  idleReminderMinutes: number
  theme: ThemePreference
  /**
   * 알림음. 전역 하나다 — 행동마다 소리를 다르게 두면 설정이 늘어나는 만큼 얻는 게 없다.
   * 실제 재생은 오버레이 창이 한다 (메인 창은 숨어 있을 수 있다).
   */
  soundEnabled: boolean
  /** 0~100. 0 이면 켜져 있어도 들리지 않는다 */
  soundVolume: number
  /**
   * 창을 처음 숨길 때(닫기 X, 백그라운드 실행 버튼 공통) 뜨는 1회성 안내 토스트를
   * 이미 보여줬는가. 세션이 아니라 **설치 전체에서 한 번**이라 여기 앱 설정에 둔다.
   */
  backgroundNoticeShown: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  idleReminderEnabled: true,
  idleReminderMinutes: 30,
  theme: DEFAULT_THEME,
  soundEnabled: true,
  soundVolume: 60,
  backgroundNoticeShown: false,
}

/** 범위 밖이면 **기본값으로 되돌린다** (경계로 붙이지 않는다 — 저장된 값이 손상된 경우다) */
function clampRange(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback
  const rounded = Math.round(value)
  if (rounded < min || rounded > max) return fallback
  return rounded
}

/**
 * 리마인더 간격(분)을 허용 범위 **안으로 밀어 넣는다**. 위의 `clampRange` 와 성격이 다르다 —
 * 저장돼 있던 값이 범위 밖이면 그건 손상이라 기본값으로 되돌리는 게 맞지만, 사용자가
 * 입력하는 중이라면 가까운 경계로 붙이는 게 덜 놀랍다. 행동의 간격칸과 같은 규칙이다
 * (`clampIntervalMinutes`). 비었거나 숫자가 아니면 최솟값.
 */
export function clampIdleReminderMinutes(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return MIN_IDLE_REMINDER_MINUTES
  const rounded = Math.round(n)
  if (rounded < MIN_IDLE_REMINDER_MINUTES) return MIN_IDLE_REMINDER_MINUTES
  if (rounded > MAX_IDLE_REMINDER_MINUTES) return MAX_IDLE_REMINDER_MINUTES
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
    idleReminderMinutes: clampRange(
      partial.idleReminderMinutes ?? DEFAULT_SETTINGS.idleReminderMinutes,
      DEFAULT_SETTINGS.idleReminderMinutes,
      MIN_IDLE_REMINDER_MINUTES,
      MAX_IDLE_REMINDER_MINUTES
    ),
    theme: normalizeThemePreference(partial.theme),
    soundEnabled:
      typeof partial.soundEnabled === 'boolean'
        ? partial.soundEnabled
        : DEFAULT_SETTINGS.soundEnabled,
    soundVolume: clampRange(
      partial.soundVolume ?? DEFAULT_SETTINGS.soundVolume,
      DEFAULT_SETTINGS.soundVolume,
      MIN_SOUND_VOLUME,
      MAX_SOUND_VOLUME
    ),
    backgroundNoticeShown:
      typeof partial.backgroundNoticeShown === 'boolean'
        ? partial.backgroundNoticeShown
        : DEFAULT_SETTINGS.backgroundNoticeShown,
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
