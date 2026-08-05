import { useEffect, useState } from 'react'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { SETTINGS } from '../../constants/strings'

export default function SettingsWindow() {
  const [autostart, setAutostart] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    isEnabled()
      .then(setAutostart)
      .catch(() => setError(SETTINGS.AUTOSTART_ERROR))
  }, [])

  async function toggle(next: boolean) {
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

  return (
    <main className="settings">
      <h1>{SETTINGS.TITLE}</h1>

      <label className="row">
        <input
          type="checkbox"
          checked={autostart === true}
          disabled={autostart === null}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>{SETTINGS.AUTOSTART_LABEL}</span>
      </label>

      <p className="hint">{SETTINGS.AUTOSTART_HINT}</p>
      {error && <p className="error">{error}</p>}
    </main>
  )
}
