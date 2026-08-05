import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { PhysicalPosition, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window'
import { computeOverlayWindowPosition } from '../../core/overlayPosition'
import { OVERLAY } from '../../constants/strings'

/** 슬라이드 아웃 CSS transition 시간과 맞춰야 한다 (overlay.css) */
const SLIDE_OUT_MS = 220

type OverlayAction = 'done' | 'snoozed' | 'skipped'

/** D0 스파이크에서는 고정 페이로드. D1에서 Behavior/Occurrence로 대체된다. */
interface OverlayPayload {
  icon: string
  message: string
}

const SPIKE_PAYLOAD: OverlayPayload = {
  icon: OVERLAY.SPIKE_ICON,
  message: OVERLAY.SPIKE_MESSAGE,
}

export default function OverlayWindow() {
  const [payload, setPayload] = useState<OverlayPayload | null>(null)
  const [slidIn, setSlidIn] = useState(false)
  const dismissingRef = useRef(false)

  /** 주 모니터 중앙 상단으로 창을 옮긴 뒤, 포커스를 뺏지 않는 방식으로 표시한다. */
  const showCard = useCallback(async (next: OverlayPayload) => {
    const appWindow = getCurrentWindow()

    const monitor = await primaryMonitor()
    if (monitor) {
      const size = await appWindow.outerSize()
      const pos = computeOverlayWindowPosition(
        {
          x: monitor.position.x,
          y: monitor.position.y,
          width: monitor.size.width,
          height: monitor.size.height,
        },
        { width: size.width, height: size.height }
      )
      await appWindow.setPosition(new PhysicalPosition(pos.x, pos.y))
    }

    dismissingRef.current = false
    setPayload(next)
    setSlidIn(false)

    // Win32 SW_SHOWNOACTIVATE + HWND_TOPMOST — 뒤 창의 포커스를 유지한 채 띄운다
    await invoke('show_overlay_noactivate')

    // 위치 이동 + show 이후에 transition을 걸어야 슬라이드가 보인다
    requestAnimationFrame(() => requestAnimationFrame(() => setSlidIn(true)))
  }, [])

  const dismiss = useCallback((action: OverlayAction) => {
    if (dismissingRef.current) return
    dismissingRef.current = true

    // 웹뷰 콘솔 + Rust stdout 양쪽에 남긴다 (D0 검증용)
    console.log('[overlay] action =', action)
    void invoke('log_overlay_action', { action })

    setSlidIn(false)
    window.setTimeout(() => {
      void invoke('hide_overlay')
      setPayload(null)
    }, SLIDE_OUT_MS)
  }, [])

  useEffect(() => {
    const unlisten = listen('overlay://show', () => {
      void showCard(SPIKE_PAYLOAD)
    })
    return () => {
      void unlisten.then((fn) => fn())
    }
  }, [showCard])

  // `--debug-cmd overlay-action:done` 이 버튼 클릭과 같은 경로를 타게 한다.
  // 이벤트를 보내는 쪽(Rust)이 개발 빌드에서만 emit 하므로 릴리스에서는 절대 발생하지 않는다.
  useEffect(() => {
    const unlisten = listen<string>('overlay://debug-action', (event) => {
      dismiss(event.payload as OverlayAction)
    })
    return () => {
      void unlisten.then((fn) => fn())
    }
  }, [dismiss])

  return (
    // 창 전체는 투명. 카드 바깥은 그리지 않는다.
    <div className="overlay-root">
      {payload && (
        <div className={`card${slidIn ? ' card--in' : ''}`} role="alert">
          <div className="card__body">
            <span className="card__icon" aria-hidden="true">
              {payload.icon}
            </span>
            <p className="card__message">{payload.message}</p>
          </div>
          <div className="card__actions">
            <button className="btn btn--primary" onClick={() => dismiss('done')}>
              {OVERLAY.ACTION_DONE}
            </button>
            <button className="btn" onClick={() => dismiss('snoozed')}>
              {OVERLAY.ACTION_SNOOZE}
            </button>
            <button className="btn btn--ghost" onClick={() => dismiss('skipped')}>
              {OVERLAY.ACTION_SKIP}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
