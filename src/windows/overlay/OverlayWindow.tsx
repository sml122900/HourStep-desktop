import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  PhysicalPosition,
  PhysicalSize,
  getCurrentWindow,
  primaryMonitor,
} from '@tauri-apps/api/window'
import { computeOverlayWindowPosition } from '../../core/overlayPosition'
import { PRESET_BEHAVIORS, findBehavior } from '../../core/presets'
import { SNOOZE_MS, computeNextOccurrences, occurrenceId } from '../../core/scheduler'
import type {
  Behavior,
  CompletionAction,
  CompletionLog,
  Occurrence,
  WorkSession,
} from '../../core/types'
import { BEHAVIOR_MESSAGE, OVERLAY } from '../../constants/strings'

/** 슬라이드 아웃 CSS transition 시간과 맞춰야 한다 (overlay.css) */
const SLIDE_OUT_MS = 220

/**
 * 카드 위쪽에 둘 여백(논리 px). 0이면 화면 최상단에 딱 붙는다.
 *
 * 창을 카드 실크기로 맞추기 때문에 이 값이 그대로 "클릭이 막히는 죽은 영역"이 된다.
 * 0을 기본으로 두는 이유가 그것 — 「알려진 한계 1」 해소가 D1 목표다.
 */
const TOP_GAP = 0

/** 밀린 알림 소진 기준. 이보다 오래된 것은 표시하지 않고 버린다 (앱 절전/장시간 카드 방치 대비) */
const STALE_MS = 2 * 60_000

type Phase = 'card' | 'offer' | 'counting'

interface Active {
  behavior: Behavior
  occurrence: Occurrence
}

export default function OverlayWindow() {
  const [active, setActiveState] = useState<Active | null>(null)
  const [phase, setPhase] = useState<Phase>('card')
  const [remainingMs, setRemainingMs] = useState(0)
  const [slidIn, setSlidIn] = useState(false)

  const cardRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<Active | null>(null)
  const sessionRef = useRef<WorkSession | null>(null)
  const snoozesRef = useRef<Occurrence[]>([])
  const firedRef = useRef<Set<string>>(new Set())
  /** D1은 인메모리. SQLite 영속화는 D2. */
  const logsRef = useRef<CompletionLog[]>([])
  /** Rust tick 이 준 마지막 "지금". 가상 시각(`--debug-cmd tick:`)이 반영돼 있다. */
  const nowRef = useRef<number>(0)
  const dismissingRef = useRef(false)

  const setActive = useCallback((next: Active | null) => {
    activeRef.current = next
    setActiveState(next)
  }, [])

  const show = useCallback(
    (behavior: Behavior, occurrence: Occurrence) => {
      dismissingRef.current = false
      setPhase('card')
      setSlidIn(false)
      setActive({ behavior, occurrence })
    },
    [setActive]
  )

  const hide = useCallback(() => {
    setSlidIn(false)
    window.setTimeout(() => {
      void invoke('hide_overlay')
      setActive(null)
      setPhase('card')
      dismissingRef.current = false
    }, SLIDE_OUT_MS)
  }, [setActive])

  const dismiss = useCallback(
    (action: CompletionAction) => {
      const current = activeRef.current
      if (!current || dismissingRef.current) return
      dismissingRef.current = true

      const at = nowRef.current
      const log: CompletionLog = {
        occurrenceId: occurrenceId(current.occurrence),
        behaviorId: current.behavior.id,
        action,
        at,
      }
      logsRef.current.push(log)

      // 웹뷰 콘솔 + Rust stdout 양쪽에 남긴다 (자동 검증이 stdout 을 파싱한다)
      console.log('[overlay] action =', action, log)
      void invoke('log_overlay_action', { action })
      void invoke('log_completion', { behavior: current.behavior.id, action, at })

      firedRef.current.add(log.occurrenceId)

      if (action === 'snoozed') {
        snoozesRef.current.push({
          behaviorId: current.behavior.id,
          dueAt: at + SNOOZE_MS,
          origin: 'snooze',
        })
      }

      // 완료 + 카운트다운이 있는 행동이면 여기서 끝내지 않고 제안을 띄운다 (선택형)
      if (action === 'done' && current.behavior.countdownMs) {
        dismissingRef.current = false
        setPhase('offer')
        return
      }

      hide()
    },
    [hide]
  )

  /**
   * 카드가 실제로 차지하는 크기에 창을 맞춘다 — 투명 영역이 남지 않아야 클릭이 통과한다.
   *
   * 순서가 중요하다. **표시가 먼저, 측정이 나중.** 숨겨진 WebView2 는 레이아웃을 돌리지
   * 않아서 `getBoundingClientRect()` 가 전부 0으로 나온다. 카드는 이 시점에
   * `translateY(-100%) / opacity:0` 이라 창을 먼저 띄워도 화면에는 아무것도 안 보인다.
   */
  const fitWindow = useCallback(async () => {
    const appWindow = getCurrentWindow()

    // Win32 SW_SHOWNOACTIVATE + HWND_TOPMOST — 뒤 창의 포커스를 유지한 채 띄운다
    await invoke('show_overlay_noactivate')
    await new Promise((resolve) => requestAnimationFrame(resolve))

    const el = cardRef.current
    const rect = el?.getBoundingClientRect()
    if (rect && rect.width >= 1 && rect.height >= 1) {
      const scale = await appWindow.scaleFactor()
      const size = new PhysicalSize(Math.ceil(rect.width * scale), Math.ceil(rect.height * scale))
      await appWindow.setSize(size)

      const monitor = await primaryMonitor()
      if (monitor) {
        const pos = computeOverlayWindowPosition(
          {
            x: monitor.position.x,
            y: monitor.position.y,
            width: monitor.size.width,
            height: monitor.size.height,
          },
          { width: size.width, height: size.height }
        )
        await appWindow.setPosition(new PhysicalPosition(pos.x, pos.y + Math.round(TOP_GAP * scale)))
      }
    } else {
      // 측정 실패해도 카드는 떠야 한다. tauri.conf.json 의 기본 크기로 간다 (죽은 영역은 남는다).
      void invoke('log_overlay_action', { action: '경고: 카드 측정 실패 — 기본 창 크기 사용' })
    }

    requestAnimationFrame(() => requestAnimationFrame(() => setSlidIn(true)))
  }, [])

  // 내용이 바뀌면(카드 → 제안 → 카운트다운) 창 크기를 다시 맞춘다.
  // remainingMs 는 의존성에서 뺀다 — 매초 리사이즈할 이유가 없다.
  useLayoutEffect(() => {
    if (!active) return
    fitWindow().catch((e) => {
      console.error('[overlay] fitWindow 실패', e)
      void invoke('log_overlay_action', { action: `오류: fitWindow 실패 — ${e}` })
    })
  }, [active, phase, fitWindow])

  // 카운트다운 진행. 카드가 보이는 동안에만 도니까 웹뷰 스로틀링 영향이 없다.
  useEffect(() => {
    if (phase !== 'counting') return
    const timer = window.setInterval(() => {
      setRemainingMs((prev) => {
        const next = prev - 1000
        if (next <= 0) {
          window.clearInterval(timer)
          hide()
          return 0
        }
        return next
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [phase, hide])

  /** Rust 1초 tick — 실제 발화 판단은 전부 여기서 순수 함수로 한다 */
  const onTick = useCallback(
    (now: number) => {
      nowRef.current = now
      const session = sessionRef.current
      if (!session || activeRef.current) return

      const elapsed = now - session.startedAt
      if (elapsed <= 0) return

      snoozesRef.current = snoozesRef.current.filter(
        (o) => !firedRef.current.has(occurrenceId(o)) && o.dueAt > now - STALE_MS
      )

      // 세션 시작부터 지금까지의 예정분을 전부 뽑아서, 아직 안 띄운 것 중 첫 번째를 띄운다.
      // ponytail: 매 tick 전체 재계산. 세션 10시간 × 3행동이면 수십 개라 무시할 비용.
      const due = computeNextOccurrences(
        session,
        PRESET_BEHAVIORS,
        session.startedAt,
        elapsed,
        snoozesRef.current
      )

      for (const occurrence of due) {
        const id = occurrenceId(occurrence)
        if (firedRef.current.has(id)) continue
        if (now - occurrence.dueAt > STALE_MS) {
          firedRef.current.add(id) // 너무 밀린 건 소진시킨다 (한꺼번에 몰아 띄우지 않는다)
          continue
        }
        const behavior = findBehavior(occurrence.behaviorId)
        if (!behavior) continue
        firedRef.current.add(id)
        show(behavior, occurrence)
        return
      }
    },
    [show]
  )

  const applySession = useCallback(
    (startedAt: number | null) => {
      if (startedAt === null) {
        sessionRef.current = null
        snoozesRef.current = []
        firedRef.current.clear()
        if (activeRef.current) hide() // 세션이 끝나면 떠 있던 카드도 치운다
        return
      }
      sessionRef.current = { id: `s-${startedAt}`, startedAt, endedAt: null }
      snoozesRef.current = []
      firedRef.current.clear()
      if (nowRef.current === 0) nowRef.current = startedAt
    },
    [hide]
  )

  useEffect(() => {
    const unlisteners = [
      listen<{ now: number }>('app://tick', (e) => onTick(e.payload.now)),
      listen<{ startedAt: number | null }>('session://changed', (e) =>
        applySession(e.payload.startedAt)
      ),
      // 트레이 [테스트 알림] — 스케줄과 무관하게 한 장 띄운다
      listen<string>('overlay://show', (e) => {
        const behavior = findBehavior(e.payload) ?? PRESET_BEHAVIORS[0]
        show(behavior, {
          behaviorId: behavior.id,
          dueAt: nowRef.current,
          origin: 'regular',
        })
      }),
      // `--debug-cmd done|snoozed|skipped` 가 버튼 클릭과 같은 경로를 타게 한다
      listen<string>('overlay://debug-action', (e) => dismiss(e.payload as CompletionAction)),
    ]

    // 창이 만들어지기 전에 나간 session://changed 를 놓칠 수 있으므로 한 번 물어본다
    void invoke<number | null>('current_session').then((startedAt) => {
      if (startedAt !== null && startedAt !== undefined) applySession(startedAt)
    })

    return () => {
      unlisteners.forEach((p) => void p.then((fn) => fn()))
    }
  }, [onTick, applySession, show, dismiss])

  const message = active ? (BEHAVIOR_MESSAGE[active.behavior.id] ?? active.behavior.label) : ''
  const seconds = Math.ceil(remainingMs / 1000)

  return (
    // 창 전체는 투명. 카드 영역 밖은 그리지 않는다.
    <div className="overlay-root">
      {active && (
        <div ref={cardRef} className={`card${slidIn ? ' card--in' : ''}`} role="alert">
          <div className="card__body">
            <span className="card__icon" aria-hidden="true">
              {active.behavior.emoji}
            </span>
            <p className="card__message">
              {phase === 'card' && message}
              {phase === 'offer' && OVERLAY.COUNTDOWN_OFFER}
              {phase === 'counting' &&
                `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
            </p>
          </div>

          <div className="card__actions">
            {phase === 'card' && (
              <>
                <button className="btn btn--primary" onClick={() => dismiss('done')}>
                  {OVERLAY.ACTION_DONE}
                </button>
                <button className="btn" onClick={() => dismiss('snoozed')}>
                  {OVERLAY.ACTION_SNOOZE}
                </button>
                <button className="btn btn--ghost" onClick={() => dismiss('skipped')}>
                  {OVERLAY.ACTION_SKIP}
                </button>
              </>
            )}

            {phase === 'offer' && (
              <>
                <button
                  className="btn btn--primary"
                  onClick={() => {
                    setRemainingMs(active.behavior.countdownMs ?? 60_000)
                    setPhase('counting')
                  }}
                >
                  {OVERLAY.COUNTDOWN_ACCEPT}
                </button>
                <button className="btn btn--ghost" onClick={hide}>
                  {OVERLAY.COUNTDOWN_DECLINE}
                </button>
              </>
            )}

            {phase === 'counting' && (
              <button className="btn btn--ghost" onClick={hide}>
                {OVERLAY.COUNTDOWN_STOP}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
