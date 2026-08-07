import { useCallback, useEffect, useState } from 'react'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { PRESET_BEHAVIORS } from '../../core/presets'
import {
  MAX_IDLE_REMINDER_MINUTES,
  MAX_INTERVAL_MINUTES,
  MIN_IDLE_REMINDER_MINUTES,
  MIN_INTERVAL_MINUTES,
  type AppSettings,
} from '../../core/settings'
import * as db from '../../data/db'
import { SETTINGS } from '../../constants/strings'

export default function SettingsWindow() {
  const [autostart, setAutostart] = useState<boolean | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    isEnabled()
      .then(setAutostart)
      .catch(() => setError(SETTINGS.AUTOSTART_ERROR))

    db.loadSettings()
      .then(setSettings)
      .catch((e) => {
        console.error('[settings] 설정 로드 실패', e)
        setError(SETTINGS.SAVE_ERROR)
      })
  }, [])

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
    // 숫자 입력을 비우면 NaN 이 들어온다. 어댑터가 정규화해서 저장하고 방송까지 한다 —
    // 범위 밖·손상된 값은 프리셋 기본값으로 되돌아간다.
    setError(null)
    try {
      setSettings(await db.saveSettingsAndBroadcast(draft))
    } catch (e) {
      console.error('[settings] 저장 실패', e)
      setError(SETTINGS.SAVE_ERROR)
      setSettings(await db.loadSettings().catch(() => null))
    }
  }, [])

  function updateBehavior(behaviorId: string, patch: { enabled?: boolean; everyMinutes?: number }) {
    if (!settings) return
    void persist({
      ...settings,
      behaviors: settings.behaviors.map((b) =>
        b.behaviorId === behaviorId ? { ...b, ...patch } : b
      ),
    })
  }

  return (
    <main className="settings">
      <h1>{SETTINGS.TITLE}</h1>

      <section>
        <h2>{SETTINGS.BEHAVIORS_TITLE}</h2>
        {settings === null ? (
          <p className="hint">…</p>
        ) : (
          <ul className="behaviors">
            {settings.behaviors.map((setting) => {
              const preset = PRESET_BEHAVIORS.find((b) => b.id === setting.behaviorId)
              return (
                <li key={setting.behaviorId} className="behavior">
                  <label className="behavior__name">
                    <input
                      type="checkbox"
                      checked={setting.enabled}
                      onChange={(e) =>
                        updateBehavior(setting.behaviorId, { enabled: e.target.checked })
                      }
                    />
                    <span>
                      {preset?.emoji} {preset?.label ?? setting.behaviorId}
                    </span>
                  </label>

                  <span className="behavior__interval">
                    <input
                      type="number"
                      min={MIN_INTERVAL_MINUTES}
                      max={MAX_INTERVAL_MINUTES}
                      value={setting.everyMinutes}
                      disabled={!setting.enabled}
                      onChange={(e) =>
                        updateBehavior(setting.behaviorId, {
                          everyMinutes: Number(e.target.value),
                        })
                      }
                    />
                    {SETTINGS.INTERVAL_SUFFIX}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        <p className="hint">{SETTINGS.BEHAVIORS_HINT}</p>
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
                settings && void persist({ ...settings, idleReminderMinutes: Number(e.target.value) })
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
