/**
 * 테마 선택 규칙 — IO 없는 순수 모듈. React·Tauri import 금지.
 *
 * `matchMedia` 조회는 창(DOM)에서 하고, 여기는 "선호 + OS 상태 → 실제로 칠할 테마"만 정한다.
 * 적용은 `src/windows/theme.ts`.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export const DEFAULT_THEME: ThemePreference = 'system'

export function normalizeThemePreference(value: unknown): ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : DEFAULT_THEME
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  return prefersDark ? 'dark' : 'light'
}
