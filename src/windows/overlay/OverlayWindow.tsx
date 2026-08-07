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
import { PRESET_BEHAVIORS } from '../../core/presets'
import { SNOOZE_MS, computeNextOccurrences, occurrenceId } from '../../core/scheduler'
import { DEFAULT_SETTINGS, applySettings, type AppSettings } from '../../core/settings'
import { computeSessionSummary, type Stats } from '../../core/stats'
import type {
  Behavior,
  CompletionAction,
  CompletionLog,
  Occurrence,
  WorkSession,
} from '../../core/types'
import * as db from '../../data/db'
import { formatDuration, formatRate } from '../../data/range'
import { BEHAVIOR_MESSAGE, OVERLAY } from '../../constants/strings'

/** 슬라이드 아웃 CSS transition 시간과 맞춰야 한다 (overlay.css) */
const SLIDE_OUT_MS = 220

/**
 * 카드 위쪽에 둘 여백(논리 px). 0이면 화면 최상단에 딱 붙는다.
 *
 * 창을 카드 실크기로 맞추기 때문에 이 값이 그대로 "클릭이 막히는 죽은 영역"이 된다.
 * 0을 기본으로 두는 이유가 그것 — 「알려진 한계 1」 해소가 D1 목표였다.
 */
const TOP_GAP = 0

/** 밀린 알림 소진 기준. 이보다 오래된 것은 표시하지 않고 버린다 (절전 복귀 시 카드 폭탄 방지) */
const STALE_MS = 2 * 60_000

type Phase = 'card' | 'offer' | 'counting'

type Active =
  | { kind: 'behavior'; behavior: Behavior; occurrence: Occurrence }
  | { kind: 'idle' }
  | { kind: 'summary'; stats: Stats }

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
  /** 현재 세션의 기록. DB 에도 쓰지만 종료 요약은 이걸로 즉시 만든다 */
  const logsRef = useRef<CompletionLog[]>([])
  /** 설정이 반영된 Behavior 목록 */
  const behaviorsRef = useRef<Behavior[]>(PRESET_BEHAVIORS)
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS)
  /** Rust tick 이 준 마지막 "지금". 가상 시각(`--debug-cmd tick:`)이 반영돼 있다. */
  const nowRef = useRef<number>(0)
  /** 세션이 없어진 시점(또는 앱 시작 시점). 미시작 리마인더 기준 */
  const idleSinceRef = useRef<number | null>(null)
  const idleRemindedRef = useRef(false)
  const dismissingRef = useRef(false)

  const setActive = useCallback((next: Active | null) => {
    activeRef.current = next
    setActiveState(next)
  }, [])

  const openCard = useCallback(
    (next: Active) => {
      dismissingRef.current = false
      setPhase('card')
      setSlidIn(false)
      setActive(next)
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
      if (current?.kind !== 'behavior' || dismissingRef.current) return
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

      const session = sessionRef.current
      if (session) {
        db.insertLog(session.id, log).catch((e) => {
          console.error('[overlay] CompletionLog 저장 실패', e)
          void invoke('log_overlay_action', { action: `오류: 기록 저장 실패 — ${e}` })
        })
      }

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

  const reloadSettings = useCallback(async () => {
    const settings = await db.loadSettings()
    settingsRef.current = settings
    behaviorsRef.current = applySettings(PRESET_BEHAVIORS, settings)
    console.log('[overlay] 설정 반영', settings)
  }, [])

  /** 세션 없이 N분이 지나면 한 번만 알린다. 세션이 시작/종료될 때 플래그가 리셋된다. */
  const maybeRemindIdle = useCallback(
    (at: number) => {
      if (activeRef.current || idleRemindedRef.current) return
      const settings = settingsRef.current
      if (!settings.idleReminderEnabled) return
      const since = idleSinceRef.current
      if (since === null || at - since < settings.idleReminderMinutes * 60_000) return

      idleRemindedRef.current = true // 반복 금지
      console.log('[overlay] 세션 미시작 리마인더')
      void invoke('log_overlay_action', { action: 'idle-reminder' })
      openCard({ kind: 'idle' })
    },
    [openCard]
  )

  /** Rust 1초 tick — 실제 발화 판단은 전부 여기서 순수 함수로 한다 */
  const onTick = useCallback(
    (now: number) => {
      nowRef.current = now
      idleSinceRef.current ??= now

      const session = sessionRef.current
      if (!session) {
        maybeRemindIdle(now)
        return
      }
      if (activeRef.current) return

      const elapsed = now - session.startedAt
      if (elapsed <= 0) return

      snoozesRef.current = snoozesRef.current.filter(
        (o) => !firedRef.current.has(occurrenceId(o)) && o.dueAt > now - STALE_MS
      )

      // 세션 시작부터 지금까지의 예정분을 전부 뽑아서, 아직 안 띄운 것 중 첫 번째를 띄운다.
      const due = computeNextOccurrences(
        session,
        behaviorsRef.current,
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
        const behavior = behaviorsRef.current.find((b) => b.id === occurrence.behaviorId)
        if (!behavior) continue
        firedRef.current.add(id)
        openCard({ kind: 'behavior', behavior, occurrence })
        return
      }
    },
    [openCard, maybeRemindIdle]
  )

  const applySession = useCallback(
    (startedAt: number | null, endedAt: number | null) => {
      if (startedAt !== null) {
        const session: WorkSession = { id: `s-${startedAt}`, startedAt, endedAt: null }
        sessionRef.current = session
        snoozesRef.current = []
        firedRef.current.clear()
        logsRef.current = []
        idleSinceRef.current = null
        idleRemindedRef.current = false
        if (nowRef.current === 0) nowRef.current = startedAt
        if (activeRef.current?.kind === 'idle') hide()

        db.insertSession(session).catch((e) => {
          console.error('[overlay] 세션 저장 실패', e)
          void invoke('log_overlay_action', { action: `오류: 세션 저장 실패 — ${e}` })
        })
        return
      }

      // 종료
      const previous = sessionRef.current
      sessionRef.current = null
      snoozesRef.current = []
      firedRef.current.clear()
      const at = endedAt ?? nowRef.current
      idleSinceRef.current = at
      idleRemindedRef.current = false

      if (!previous) {
        if (activeRef.current) hide()
        return
      }

      db.closeSession(previous.id, at).catch((e) => {
        console.error('[overlay] 세션 종료 저장 실패', e)
        void invoke('log_overlay_action', { action: `오류: 세션 종료 저장 실패 — ${e}` })
      })

      const stats = computeSessionSummary(
        { ...previous, endedAt: at },
        logsRef.current,
        at,
        behaviorsRef.current.filter((b) => b.enabled).map((b) => b.id)
      )
      console.log('[overlay] 세션 요약', stats)
      void invoke('log_overlay_action', {
        action: `summary worked=${stats.workedMs} total=${stats.overall.total} done=${stats.overall.done}`,
      })
      openCard({ kind: 'summary', stats })
    },
    [hide, openCard]
  )

  useEffect(() => {
    const unlisteners = [
      listen<{ now: number }>('app://tick', (e) => onTick(e.payload.now)),
      listen<{ startedAt: number | null; endedAt: number | null }>('session://changed', (e) =>
        applySession(e.payload.startedAt, e.payload.endedAt)
      ),
      listen('settings://changed', () => void reloadSettings()),
      // 트레이 [테스트 알림] — 스케줄과 무관하게 한 장 띄운다
      listen<string>('overlay://show', (e) => {
        const behavior =
          behaviorsRef.current.find((b) => b.id === e.payload) ?? behaviorsRef.current[0]
        openCard({
          kind: 'behavior',
          behavior,
          occurrence: { behaviorId: behavior.id, dueAt: nowRef.current, origin: 'regular' },
        })
      }),
      // `--debug-cmd done|snoozed|skipped` 가 버튼 클릭과 같은 경로를 타게 한다
      listen<string>('overlay://debug-action', (e) => {
        if (activeRef.current?.kind === 'behavior') dismiss(e.payload as CompletionAction)
        else hide()
      }),
      // `--debug-cmd db-dump` — DB 는 어댑터만 읽으므로 여기서 찍어 stdout 으로 넘긴다
      listen('overlay://debug-db-dump', () => {
        void db
          .summarize()
          .then((line) => invoke('log_debug', { line }))
          .catch((e) => invoke('log_debug', { line: `db-dump 실패: ${e}` }))
      }),
      // `--debug-cmd set-interval:<behaviorId>=<분>` — 설정 창의 저장 경로와 같은 함수를 탄다
      listen<string>('overlay://debug-set-interval', (e) => {
        const [behaviorId, raw] = e.payload.split('=')
        void db
          .loadSettings()
          .then((current) =>
            db.saveSettingsAndBroadcast({
              ...current,
              behaviors: current.behaviors.map((b) =>
                b.behaviorId === behaviorId ? { ...b, everyMinutes: Number(raw) } : b
              ),
            })
          )
          .then((saved) => {
            const applied = saved.behaviors.find((b) => b.behaviorId === behaviorId)
            return invoke('log_debug', {
              line: `settings ${behaviorId}.everyMinutes=${applied?.everyMinutes}`,
            })
          })
          .catch((err) => invoke('log_debug', { line: `set-interval 실패: ${err}` }))
      }),
    ]

    void (async () => {
      // 순서가 있다. 강제 종료로 열린 채 남은 세션을 **먼저** 닫고, 설정을 읽어 스케줄을
      // 확정한 다음, 마지막에 현재 세션을 확인한다. 창이 만들어지기 전에 나간
      // session://changed 를 놓칠 수 있어서 마지막 단계가 필요하다.
      const bootedAt = Date.now()
      try {
        const closed = await db.closeDanglingSessions(bootedAt)
        if (closed > 0) console.log(`[overlay] 미종료 세션 ${closed}건 정리`)
      } catch (e) {
        console.error('[overlay] 미종료 세션 정리 실패', e)
      }

      try {
        await reloadSettings()
      } catch (e) {
        console.error('[overlay] 설정 로드 실패', e)
      }

      const startedAt = await invoke<number | null>('current_session')
      if (startedAt !== null && startedAt !== undefined) applySession(startedAt, null)
    })()

    return () => {
      unlisteners.forEach((p) => void p.then((fn) => fn()))
    }
  }, [onTick, applySession, openCard, dismiss, hide, reloadSettings])

  const seconds = Math.ceil(remainingMs / 1000)

  return (
    // 창 전체는 투명. 카드 영역 밖은 그리지 않는다.
    <div className="overlay-root">
      {active && (
        <div ref={cardRef} className={`card${slidIn ? ' card--in' : ''}`} role="alert">
          {active.kind === 'behavior' && (
            <BehaviorCard
              behavior={active.behavior}
              phase={phase}
              seconds={seconds}
              onDismiss={dismiss}
              onAcceptCountdown={() => {
                setRemainingMs(active.behavior.countdownMs ?? 60_000)
                setPhase('counting')
              }}
              onClose={hide}
            />
          )}

          {active.kind === 'idle' && (
            <>
              <div className="card__body">
                <span className="card__icon" aria-hidden="true">
                  {OVERLAY.IDLE_ICON}
                </span>
                <p className="card__message">{OVERLAY.IDLE_MESSAGE}</p>
              </div>
              <div className="card__actions">
                <button
                  className="btn btn--primary"
                  onClick={() => {
                    void invoke('start_session_command')
                  }}
                >
                  {OVERLAY.IDLE_START}
                </button>
                <button className="btn btn--ghost" onClick={hide}>
                  {OVERLAY.IDLE_LATER}
                </button>
              </div>
            </>
          )}

          {active.kind === 'summary' && <SummaryCard stats={active.stats} onClose={hide} />}
        </div>
      )}
    </div>
  )
}

function BehaviorCard({
  behavior,
  phase,
  seconds,
  onDismiss,
  onAcceptCountdown,
  onClose,
}: {
  behavior: Behavior
  phase: Phase
  seconds: number
  onDismiss: (action: CompletionAction) => void
  onAcceptCountdown: () => void
  onClose: () => void
}) {
  const message = BEHAVIOR_MESSAGE[behavior.id] ?? behavior.label

  return (
    <>
      <div className="card__body">
        <span className="card__icon" aria-hidden="true">
          {behavior.emoji}
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
            <button className="btn btn--primary" onClick={() => onDismiss('done')}>
              {OVERLAY.ACTION_DONE}
            </button>
            <button className="btn" onClick={() => onDismiss('snoozed')}>
              {OVERLAY.ACTION_SNOOZE}
            </button>
            <button className="btn btn--ghost" onClick={() => onDismiss('skipped')}>
              {OVERLAY.ACTION_SKIP}
            </button>
          </>
        )}

        {phase === 'offer' && (
          <>
            <button className="btn btn--primary" onClick={onAcceptCountdown}>
              {OVERLAY.COUNTDOWN_ACCEPT}
            </button>
            <button className="btn btn--ghost" onClick={onClose}>
              {OVERLAY.COUNTDOWN_DECLINE}
            </button>
          </>
        )}

        {phase === 'counting' && (
          <button className="btn btn--ghost" onClick={onClose}>
            {OVERLAY.COUNTDOWN_STOP}
          </button>
        )}
      </div>
    </>
  )
}

function SummaryCard({ stats, onClose }: { stats: Stats; onClose: () => void }) {
  const recorded = stats.byBehavior.filter((s) => s.total > 0)

  return (
    <>
      <div className="card__body">
        <span className="card__icon" aria-hidden="true">
          {OVERLAY.SUMMARY_ICON}
        </span>
        <p className="card__message">
          {OVERLAY.SUMMARY_TITLE} · {OVERLAY.SUMMARY_WORKED} {formatDuration(stats.workedMs)}
        </p>
      </div>

      {recorded.length === 0 ? (
        <p className="card__note">{OVERLAY.SUMMARY_NO_RECORD}</p>
      ) : (
        <ul className="card__summary">
          {recorded.map((stat) => {
            const behavior = PRESET_BEHAVIORS.find((b) => b.id === stat.behaviorId)
            return (
              <li key={stat.behaviorId}>
                <span>
                  {behavior ? `${behavior.emoji} ${behavior.label}` : stat.behaviorId}
                </span>
                <span className="card__summary-rate">
                  {formatRate(stat.rate)}
                  <em>
                    {stat.done}/{stat.total}
                  </em>
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <div className="card__actions">
        <button className="btn btn--primary" onClick={onClose}>
          {OVERLAY.SUMMARY_CLOSE}
        </button>
      </div>
    </>
  )
}
