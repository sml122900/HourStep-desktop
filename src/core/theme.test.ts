import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, normalizeThemePreference, resolveTheme } from './theme'

describe('resolveTheme', () => {
  it('명시 선택은 OS 상태를 무시한다', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('system 은 OS 상태를 따른다', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('normalizeThemePreference', () => {
  it('3택만 통과시킨다', () => {
    expect(normalizeThemePreference('light')).toBe('light')
    expect(normalizeThemePreference('dark')).toBe('dark')
    expect(normalizeThemePreference('system')).toBe('system')
  })

  it('모르는 값은 기본값', () => {
    for (const bad of [undefined, null, '', 'neon', 42, {}]) {
      expect(normalizeThemePreference(bad)).toBe(DEFAULT_THEME)
    }
  })
})
