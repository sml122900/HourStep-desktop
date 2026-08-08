/**
 * 테마를 실제 DOM 에 칠하는 곳. 세 창(main / settings / overlay)이 각자 한 번씩 부른다.
 *
 * 선택 규칙 자체는 `src/core/theme.ts` 의 순수 함수다. 여기는 그 함수에 넣을 재료
 * (저장된 선호 + OS 상태)를 모으고 결과를 `<html data-theme>` 에 붙이는 IO 뿐이다.
 */

import { listen } from '@tauri-apps/api/event'
import { resolveTheme, type ThemePreference } from '../core/theme'
import * as db from '../data/db'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** 현재 선호. OS 테마가 바뀌었을 때 DB 를 다시 읽지 않고 바로 다시 칠하기 위해 들고 있는다. */
let preference: ThemePreference = 'system'

export function applyTheme(next: ThemePreference): void {
  preference = next
  const prefersDark = window.matchMedia(DARK_QUERY).matches
  document.documentElement.dataset.theme = resolveTheme(next, prefersDark)
}

/**
 * 저장된 테마를 칠하고, 이후 설정 변경(`settings://changed`)과 OS 테마 변경을 따라간다.
 * 창이 사라질 때 정리하도록 해제 함수를 돌려준다.
 */
export function startThemeSync(): () => void {
  const media = window.matchMedia(DARK_QUERY)
  const onSystemChange = () => applyTheme(preference)
  media.addEventListener('change', onSystemChange)

  const reload = () =>
    db
      .loadSettings()
      .then((s) => applyTheme(s.theme))
      .catch((e) => console.error('[theme] 설정 로드 실패 — 기본 테마 유지', e))

  void reload()
  const unlisten = listen(db.SETTINGS_CHANGED, () => void reload())

  return () => {
    media.removeEventListener('change', onSystemChange)
    void unlisten.then((fn) => fn())
  }
}
