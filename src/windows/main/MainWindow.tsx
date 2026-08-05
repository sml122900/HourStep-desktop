import { invoke } from '@tauri-apps/api/core'
import { MAIN } from '../../constants/strings'

export default function MainWindow() {
  return (
    <main className="shell">
      <span className="badge">{MAIN.PHASE_BADGE}</span>
      <h1>{MAIN.TITLE}</h1>
      <p className="desc">{MAIN.DESCRIPTION}</p>

      <div className="actions">
        <button onClick={() => invoke('trigger_test_overlay')}>{MAIN.TEST_OVERLAY_BUTTON}</button>
        <button onClick={() => invoke('open_settings_window')}>{MAIN.OPEN_SETTINGS_BUTTON}</button>
        <button onClick={() => invoke('hide_main_window')}>{MAIN.HIDE_BUTTON}</button>
      </div>

      <p className="hint">
        트레이 아이콘 우클릭 → 메뉴 / 좌클릭 → 이 창 열기. 종료는 트레이 메뉴의 [종료]만.
      </p>
    </main>
  )
}
