import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import {
  MAX_BEHAVIORS,
  MAX_EMOJI_CODEPOINTS,
  MAX_INTERVAL_MINUTES,
  MAX_LABEL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MIN_INTERVAL_MINUTES,
  intervalMinutes,
  moveBehavior,
  newBehavior,
  restoreBuiltins,
} from '../../core/behaviors'
import {
  MAX_IDLE_REMINDER_MINUTES,
  MIN_IDLE_REMINDER_MINUTES,
  type AppSettings,
} from '../../core/settings'
import { THEME_PREFERENCES, type ThemePreference } from '../../core/theme'
import type { Behavior } from '../../core/types'
import * as db from '../../data/db'
import { SETTINGS } from '../../constants/strings'

const MIN = 60_000

const THEME_LABEL: Record<ThemePreference, string> = {
  system: SETTINGS.THEME_SYSTEM,
  light: SETTINGS.THEME_LIGHT,
  dark: SETTINGS.THEME_DARK,
}

/** 이모지 입력 상한. maxLength 는 UTF-16 단위라 코드포인트의 2배로 잡는다 */
const EMOJI_MAXLENGTH = MAX_EMOJI_CODEPOINTS * 2

export default function SettingsWindow() {
  const [autostart, setAutostart] = useState<boolean | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [behaviors, setBehaviors] = useState<Behavior[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * 글자 입력은 매 타이핑마다 저장하지 않는다 (DB 쓰기 + 방송 + 정규화가 커서를 튕긴다).
   * 화면 상태를 먼저 바꾸고 포커스가 빠질 때 저장한다. 그래서 "아직 저장 안 된 화면 값"이
   * 존재하고, 커밋할 때 그 최신값을 읽어야 하므로 ref 로 따로 들고 있는다.
   */
  const draftRef = useRef<Behavior[] | null>(null)
  draftRef.current = behaviors

  const reload = useCallback(() => {
    db.loadSettings()
      .then(setSettings)
      .catch((e) => {
        console.error('[settings] 설정 로드 실패', e)
        setError(SETTINGS.SAVE_ERROR)
      })

    db.loadBehaviors()
      .then(setBehaviors)
      .catch((e) => {
        console.error('[settings] 행동 로드 실패', e)
        setError(SETTINGS.SAVE_ERROR)
      })
  }, [])

  useEffect(() => {
    isEnabled()
      .then(setAutostart)
      .catch(() => setError(SETTINGS.AUTOSTART_ERROR))
    reload()
  }, [reload])

  async function toggleAutostart(next: boolean) {
    setError(null)
    try {
      if (next) await enable()
      else await disable()
      setAutostart(await isEnabled())
    } catch {
      setError(SETTINGS.AUTOSTART_ERROR)
      setAutostart(await isEnabled().catch(() => null))
    }
  }

  /**
   * 저장 즉시 다른 창에 알린다. 오버레이가 이걸 받아 실행 중인 세션의 스케줄을 다시 계산한다.
   * 저장에 실패하면 방송하지 않는다 — 화면과 DB 가 갈라지면 안 된다.
   */
  const persist = useCallback(async (draft: AppSettings) => {
    setError(null)
    try {
      setSettings(await db.saveSettingsAndBroadcast(draft))
    } catch (e) {
      console.error('[settings] 저장 실패', e)
      setError(SETTINGS.SAVE_ERROR)
      setSettings(await db.loadSettings().catch(() => null))
    }
  }, [])

  /** 행동 목록 저장. 정규화된 결과로 화면을 되돌려 놓아 DB 와 눈에 보이는 값이 같아진다. */
  const persistBehaviors = useCallback(async (draft: Behavior[]) => {
    setError(null)
    setBehaviors(draft) // 정규화 왕복을 기다리는 동안에도 화면은 즉시 반응해야 한다
    try {
      setBehaviors(await db.saveBehaviorsAndBroadcast(draft))
    } catch (e) {
      console.error('[settings] 행동 저장 실패', e)
      setError(SETTINGS.SAVE_ERROR)
      setBehaviors(await db.loadBehaviors().catch(() => null))
    }
  }, [])

  /** 아직 저장되지 않은 화면 값을 확정한다 (입력 포커스가 빠질 때 / 창이 숨을 때) */
  const commit = useCallback(() => {
    if (draftRef.current) void persistBehaviors(draftRef.current)
  }, [persistBehaviors])

  /**
   * 이 창은 만들어질 때(앱 기동 시) 한 번 읽고 숨어 있다가 나중에 보인다. 그 사이 값이
   * 바뀌었을 수 있으므로 — 다른 창의 「기본값 복원」, `--debug-cmd`, 앱 최초 시드 —
   * **다시 보일 때** 읽어온다.
   *
   * 보이는 동안 오는 방송은 무시한다. 이 창이 유일한 편집자라 그 방송은 대부분 자기가
   * 낸 것이고, 그때 다시 읽으면 타이핑 중인 값을 덮어써 버린다.
   *
   * 반대로 창을 X 로 닫으면(=트레이로 숨김) 입력에 blur 가 안 올 수 있다.
   * 숨는 순간에 한 번 확정해서 편집 중이던 값을 잃지 않게 한다.
   */
  useEffect(() => {
    const onVisibility = () => (document.hidden ? commit() : reload())
    document.addEventListener('visibilitychange', onVisibility)

    const unlisteners = [
      listen(db.SETTINGS_CHANGED, () => document.hidden && reload()),
      listen(db.BEHAVIORS_CHANGED, () => document.hidden && reload()),
    ]

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      unlisteners.forEach((p) => void p.then((fn) => fn()))
    }
  }, [commit, reload])

  /** 화면만 바꾼다. 저장은 commit() 이 한다. */
  function editLocal(behaviorId: string, patch: Partial<Behavior>) {
    setBehaviors((prev) =>
      prev ? prev.map((b) => (b.id === behaviorId ? { ...b, ...patch } : b)) : prev
    )
  }

  const atLimit = (behaviors?.length ?? 0) >= MAX_BEHAVIORS

  return (
    <main className="settings">
      <h1>{SETTINGS.TITLE}</h1>

      <section>
        <h2>{SETTINGS.BEHAVIORS_TITLE}</h2>

        {behaviors === null ? (
          <p className="hint">…</p>
        ) : behaviors.length === 0 ? (
          <p className="hint">{SETTINGS.BEHAVIOR_EMPTY}</p>
        ) : (
          <ul className="behaviors">
            {behaviors.map((behavior, index) => (
              <li key={behavior.id} className="behavior">
                <div className="behavior__row">
                  <input
                    type="checkbox"
                    checked={behavior.enabled}
                    aria-label={behavior.label}
                    onChange={(e) =>
                      void persistBehaviors(
                        behaviors.map((b) =>
                          b.id === behavior.id ? { ...b, enabled: e.target.checked } : b
                        )
                      )
                    }
                  />

                  <input
                    className="behavior__emoji"
                    value={behavior.emoji}
                    maxLength={EMOJI_MAXLENGTH}
                    aria-label="이모지"
                    onChange={(e) => editLocal(behavior.id, { emoji: e.target.value })}
                    onBlur={commit}
                  />

                  <input
                    className="behavior__label"
                    value={behavior.label}
                    maxLength={MAX_LABEL_LENGTH}
                    placeholder={SETTINGS.BEHAVIOR_NAME_PLACEHOLDER}
                    onChange={(e) => editLocal(behavior.id, { label: e.target.value })}
                    onBlur={commit}
                  />

                  {behavior.isBuiltin && (
                    <span className="tag">{SETTINGS.BEHAVIOR_BUILTIN_TAG}</span>
                  )}

                  <span className="behavior__interval">
                    <input
                      type="number"
                      min={MIN_INTERVAL_MINUTES}
                      max={MAX_INTERVAL_MINUTES}
                      value={intervalMinutes(behavior)}
                      disabled={!behavior.enabled}
                      onChange={(e) =>
                        editLocal(behavior.id, {
                          rule: { kind: 'interval', everyMs: Number(e.target.value) * MIN },
                        })
                      }
                      onBlur={commit}
                    />
                    {SETTINGS.INTERVAL_SUFFIX}
                  </span>

                  <span className="behavior__order">
                    <button
                      title={SETTINGS.BEHAVIOR_UP}
                      disabled={index === 0}
                      onClick={() => void persistBehaviors(moveBehavior(behaviors, behavior.id, -1))}
                    >
                      ↑
                    </button>
                    <button
                      title={SETTINGS.BEHAVIOR_DOWN}
                      disabled={index === behaviors.length - 1}
                      onClick={() => void persistBehaviors(moveBehavior(behaviors, behavior.id, 1))}
                    >
                      ↓
                    </button>
                  </span>

                  <button
                    className="behavior__delete"
                    title={SETTINGS.BEHAVIOR_DELETE}
                    onClick={() =>
                      void persistBehaviors(behaviors.filter((b) => b.id !== behavior.id))
                    }
                  >
                    ✕
                  </button>
                </div>

                <input
                  className="behavior__message"
                  value={behavior.message}
                  maxLength={MAX_MESSAGE_LENGTH}
                  placeholder={SETTINGS.BEHAVIOR_MESSAGE_PLACEHOLDER}
                  disabled={!behavior.enabled}
                  onChange={(e) => editLocal(behavior.id, { message: e.target.value })}
                  onBlur={commit}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="row">
          <button
            className="chip"
            disabled={behaviors === null || atLimit}
            onClick={() =>
              behaviors &&
              // Date.now() 는 UI 계층에서만 — 코어의 newBehavior 는 now 를 인자로 받는다
              void persistBehaviors([...behaviors, newBehavior(behaviors, Date.now())])
            }
          >
            {SETTINGS.BEHAVIOR_ADD}
          </button>
          <button
            className="chip"
            disabled={behaviors === null}
            onClick={() => behaviors && void persistBehaviors(restoreBuiltins(behaviors))}
          >
            {SETTINGS.BEHAVIOR_RESTORE}
          </button>
        </div>

        <p className="hint">
          {atLimit
            ? SETTINGS.BEHAVIOR_LIMIT.replace('{n}', String(MAX_BEHAVIORS))
            : SETTINGS.BEHAVIORS_HINT}
        </p>
        <p className="hint">{SETTINGS.BEHAVIOR_RESTORE_HINT}</p>
      </section>

      <section>
        <h2>{SETTINGS.THEME_TITLE}</h2>
        <div className="segmented">
          {THEME_PREFERENCES.map((pref) => (
            <button
              key={pref}
              className={settings?.theme === pref ? 'is-on' : undefined}
              disabled={settings === null}
              onClick={() => settings && void persist({ ...settings, theme: pref })}
            >
              {THEME_LABEL[pref]}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>{SETTINGS.IDLE_TITLE}</h2>
        <div className="row row--split">
          <label className="row">
            <input
              type="checkbox"
              checked={settings?.idleReminderEnabled ?? false}
              disabled={settings === null}
              onChange={(e) =>
                settings && void persist({ ...settings, idleReminderEnabled: e.target.checked })
              }
            />
            <span>{SETTINGS.IDLE_LABEL}</span>
          </label>

          <span className="behavior__interval">
            <input
              type="number"
              min={MIN_IDLE_REMINDER_MINUTES}
              max={MAX_IDLE_REMINDER_MINUTES}
              value={settings?.idleReminderMinutes ?? 30}
              disabled={settings === null || !settings.idleReminderEnabled}
              onChange={(e) =>
                settings &&
                void persist({ ...settings, idleReminderMinutes: Number(e.target.value) })
              }
            />
            {SETTINGS.IDLE_SUFFIX}
          </span>
        </div>
      </section>

      <section>
        <label className="row">
          <input
            type="checkbox"
            checked={autostart === true}
            disabled={autostart === null}
            onChange={(e) => void toggleAutostart(e.target.checked)}
          />
          <span>{SETTINGS.AUTOSTART_LABEL}</span>
        </label>
        <p className="hint">{SETTINGS.AUTOSTART_HINT}</p>
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  )
}
