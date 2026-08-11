import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  PhysicalPosition,
  PhysicalSize,
  getCurrentWindow,
  primaryMonitor,
} from '@tauri-apps/api/window'
import { actionAt, nextActionIndex } from '../../core/actionRotation'
import {
  cardMessage,
  intervalMinutes,
  moveBehavior,
  normalizeBehavior,
  restoreBuiltins,
} from '../../core/behaviors'
import { computeOverlayWindowPosition } from '../../core/overlayPosition'
import { dequeueOccurrence, enqueueOccurrence, summarizeQueue } from '../../core/overlayQueue'
import { seedBehaviors } from '../../core/presets'
import { parseRoutineBlock, routineItemsToBehaviors } from '../../core/routineParse'
import { SNOOZE_MS, computeNextOccurrences, occurrenceId } from '../../core/scheduler'
import { DEFAULT_SETTINGS, type AppSettings } from '../../core/settings'
import { computeSessionSummary, type Stats } from '../../core/stats'
import { normalizeThemePreference } from '../../core/theme'
import type {
  Behavior,
  CompletionAction,
  CompletionLog,
  Occurrence,
  WorkSession,
} from '../../core/types'
import * as db from '../../data/db'
import { formatDuration, formatRate } from '../../data/range'
import { OVERLAY } from '../../constants/strings'
import Button from '../../components/Button'
import { playCue } from '../sound'

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

/** 동작 로테이션(D2.9)을 쓰는 유일한 내장 행동. `src/core/presets.ts` 의 id 와 같다 */
const STRETCH_ROTATION_ID = 'stretch'

/**
 * 카드의 두 모습. D2.6 까지 있던 `offer`(「1분만 같이 세어볼까요?」)는 D2.7 에서 없앴다 —
 * 행위 시간이 행동의 속성이 되면서 "셀지 말지"는 매번 물을 일이 아니라 설정에서 정할 일이 됐다.
 */
type Phase = 'card' | 'counting'

type Active =
  | { kind: 'behavior'; behavior: Behavior; occurrence: Occurrence }
  | { kind: 'idle' }
  /** labels: 요약을 만든 시점의 행동 이름. 세션 도중 이름을 바꾸거나 지워도 요약은 안 흔들린다 */
  | { kind: 'summary'; stats: Stats; labels: Map<string, string> }

/**
 * `--debug-cmd` 의 행동 CRUD. 설정 창과 **같은 함수**(`saveBehaviorsAndBroadcast`)를 타야
 * "클릭 없이 검증한 결과"가 실제 사용자 경로를 대변한다 (CLAUDE.md 「검증 정책」).
 *
 * spec: `add:<id>=<분>` / `delete:<id>` / `restore` / `interval:<id>=<분>` /
 * `move:<id>=up|down` / `ai-import:<분>`
 */
async function debugBehavior(spec: string): Promise<void> {
  const separator = spec.indexOf(':')
  const op = separator < 0 ? spec : spec.slice(0, separator)
  const arg = separator < 0 ? '' : spec.slice(separator + 1)
  const [id, rawMinutes] = arg.split('=')

  try {
    const current = await db.loadBehaviors()
    let next: Behavior[]

    switch (op) {
      case 'add':
        next = [
          ...current,
          normalizeBehavior({
            id,
            label: id,
            emoji: '🧪',
            message: `${id} 테스트 알림`,
            rule: { kind: 'interval', everyMs: Number(rawMinutes) * 60_000 },
            enabled: true,
            sortOrder: current.length,
          }),
        ]
        break
      case 'delete':
        next = current.filter((b) => b.id !== id)
        break
      case 'restore':
        next = restoreBuiltins(current)
        break
      // `move:<id>=up|down` — 설정 창의 ↑/↓ 와 같은 순수 함수를 탄다.
      // 순서는 지금까지 자동 검증 경로가 없어서 손으로만 확인할 수 있었다.
      case 'move':
        next = moveBehavior(current, id, rawMinutes === 'up' ? -1 : 1)
        break
      /**
       * D2.6 — 「AI로 루틴 찾기」의 **붙여넣기부터**를 클릭 없이 태운다.
       * 검색·브라우저 열기는 자동 검증 대상이 아니고(눈으로 본다), 여기서 검증할 것은
       * "붙여넣은 텍스트 → 파싱 → 삽입 → 실행 중 세션에서 발화" 사슬이다.
       * 설정 창 미리보기가 통과시키는 것과 **같은 함수**(parse → routineItemsToBehaviors)를 탄다.
       */
      case 'ai-import': {
        const minutes = Number(arg) > 0 ? Number(arg) : 3
        const pasted =
          '말씀하신 상황이라면 이렇게 해보세요.\n\n' +
          '```\n[HOURSTEP]\n' +
          `🦾|어깨 돌리기|${minutes}분|어깨를 천천히 뒤로 돌려주세요\n` +
          '[/HOURSTEP]\n```'
        const parsed = parseRoutineBlock(pasted)
        if (!parsed.ok) {
          await invoke('log_debug', { line: `ai-import 파싱 실패: ${parsed.reason}` })
          return
        }
        next = routineItemsToBehaviors(current, parsed.items, Date.now())
        break
      }

      case 'interval':
        next = current.map((b) =>
          b.id === id
            ? { ...b, rule: { kind: 'interval' as const, everyMs: Number(rawMinutes) * 60_000 } }
            : b
        )
        break
      // D2.7 — 행위 시간(초). 60분 뒤 알림을 기다리지 않고 카운트다운 분기를 검증하기 위한 것
      case 'duration':
        next = current.map((b) => (b.id === id ? { ...b, durationSec: Number(rawMinutes) } : b))
        break
      default:
        await invoke('log_debug', { line: `behavior 알 수 없는 명령: ${spec}` })
        return
    }

    const saved = await db.saveBehaviorsAndBroadcast(next)
    const applied = saved.find((b) => b.id === id)

    // D2 e2e 스크립트가 이 형식을 파싱한다 — set-interval 의 출력은 바꾸지 않는다
    let line = `behavior ${op} ${id ?? ''} n=${saved.length}`
    if (op === 'interval') {
      line = `settings ${id}.everyMinutes=${applied ? intervalMinutes(applied) : 'none'}`
    } else if (op === 'duration') {
      line = `settings ${id}.durationSec=${applied ? applied.durationSec : 'none'}`
    } else if (op === 'ai-import') {
      // 삽입된 행동의 id 를 찍는다 — 이어지는 tick 이 무엇을 띄워야 하는지 대조할 수 있게
      const ai = saved.filter((b) => b.source === 'ai')
      line = `behavior ai-import n=${saved.length} ai=${ai.map((b) => `${b.id}:${intervalMinutes(b)}m`).join(' ')}`
    }
    await invoke('log_debug', { line })
  } catch (e) {
    await invoke('log_debug', { line: `behavior ${spec} 실패: ${e}` })
  }
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
  /**
   * 카드가 떠 있는 동안 도래해 대기 중인 발화. 창이 하나뿐이라 겹치면 덮어쓰는 문제를
   * 큐로 직렬화한다 (docs/decisions/0009). 세션이 끝나면 통째로 버린다.
   */
  const queueRef = useRef<Occurrence[]>([])
  const firedRef = useRef<Set<string>>(new Set())
  /** 현재 세션의 기록. DB 에도 쓰지만 종료 요약은 이걸로 즉시 만든다 */
  const logsRef = useRef<CompletionLog[]>([])
  /**
   * 지금 유효한 행동 목록. **런타임 소스는 DB** 이고 시드는 첫 로드 전 한 틱을 메우는 값이다
   * (그 사이 tick 이 와도 엉뚱한 카드가 뜨지 않게 값이 비어 있지 않아야 한다).
   */
  const behaviorsRef = useRef<Behavior[]>(seedBehaviors())
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

      // ① 카드 표시 — 무조건, 행동 종류 무관. 요약 카드만 예외다: 사용자가 방금 [작업 종료]를
      // 눌러서 뜬 것이고, 알림이 아니라 보고서라 소리로 부를 이유가 없다.
      if (next.kind !== 'summary') {
        void invoke('log_debug', { line: playCue('start', settingsRef.current) })
      }
    },
    [setActive]
  )

  /**
   * 카드를 내린다. 슬라이드 아웃이 끝나면 **큐에 대기 중인 다음 알림을 이어서 띄운다** —
   * 겹친 발화는 여기서 한 줄로 풀린다 (docs/decisions/0009).
   *
   * 이어 띄울 때는 창을 숨겼다 다시 띄우지 않는다. 한 프레임 깜빡이고, 어차피 같은 자리에
   * 같은 크기로 다시 뜬다.
   */
  const hide = useCallback(() => {
    setSlidIn(false)
    window.setTimeout(() => {
      // 대기 중이던 행동이 그 사이 지워졌을 수 있다. 살아 있는 게 나올 때까지 꺼낸다.
      let queue = queueRef.current
      for (;;) {
        const { next, rest } = dequeueOccurrence(queue)
        queue = rest
        if (!next) break

        const behavior = behaviorsRef.current.find((b) => b.id === next.behaviorId)
        if (!behavior) continue

        queueRef.current = queue
        void invoke('log_debug', { line: `queue pop ${occurrenceId(next)} n=${queue.length}` })
        openCard({ kind: 'behavior', behavior, occurrence: next })
        return
      }

      queueRef.current = queue
      void invoke('hide_overlay')
      setActive(null)
      setPhase('card')
      dismissingRef.current = false
    }, SLIDE_OUT_MS)
  }, [setActive, openCard])

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
        // 이름 스냅샷. 나중에 이 행동을 지워도 통계가 이름을 잃지 않는다 (docs/decisions/0006)
        behaviorLabel: `${current.behavior.emoji} ${current.behavior.label}`,
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

      // 동작 로테이션(D2.9) — 스트레칭은 발화마다 다음 동작으로 넘어간다. 스누즈해도 다음
      // 발화(스누즈든 정규든)는 다음 동작을 본다 — 방금 본 걸 그대로 다시 보여주지 않는다.
      if (current.behavior.id === STRETCH_ROTATION_ID) {
        const next = nextActionIndex(current.behavior.actionIndex)
        const behaviors = behaviorsRef.current
        const idx = behaviors.findIndex((b) => b.id === STRETCH_ROTATION_ID)
        if (idx >= 0) {
          behaviorsRef.current = behaviors.map((b, i) => (i === idx ? { ...b, actionIndex: next } : b))
        }
        void db.saveActionIndex(STRETCH_ROTATION_ID, next).catch((e) => {
          console.error('[overlay] 동작 로테이션 저장 실패', e)
        })
      }

      if (action === 'snoozed') {
        snoozesRef.current.push({
          behaviorId: current.behavior.id,
          dueAt: at + SNOOZE_MS,
          origin: 'snooze',
        })
      }

      // 지속 행동이면 카드를 닫지 않고 그 자리에서 카운트다운으로 바뀐다.
      // 기록은 이미 'done' 이다 — 중간에 [중단]해도 되돌리지 않는다 (사용자는 실제로 시작했다).
      if (action === 'done' && current.behavior.durationSec > 0) {
        dismissingRef.current = false
        setRemainingMs(current.behavior.durationSec * 1000)
        setPhase('counting')
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
        await appWindow.setPosition(
          new PhysicalPosition(pos.x, pos.y + Math.round(TOP_GAP * scale))
        )
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
    const timer = window.setInterval(() => setRemainingMs((prev) => Math.max(0, prev - 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [phase])

  /**
   * 카운트다운 종료 — ② 알림음 + 자동 닫힘.
   *
   * 소리와 닫기를 `setRemainingMs` **updater 안에서** 하지 않는 이유: updater 는 순수해야 하고,
   * StrictMode 는 개발 중 그것을 두 번 호출한다. 소리가 두 번 울리고 hide 가 두 번 돈다.
   */
  useEffect(() => {
    if (phase !== 'counting' || remainingMs > 0) return
    void invoke('log_debug', { line: playCue('end', settingsRef.current) })
    hide()
  }, [phase, remainingMs, hide])

  const reloadSettings = useCallback(async () => {
    settingsRef.current = await db.loadSettings()
    console.log('[overlay] 설정 반영', settingsRef.current)
  }, [])

  /**
   * 행동 목록을 다시 읽는다. 실행 중인 세션에도 즉시 반영돼야 하므로 ref 만 갈아끼우고
   * 나머지는 다음 tick 이 알아서 한다 — 발화 판단은 매 tick 순수 함수로 새로 계산한다.
   *
   * 이미 띄운 것(`firedRef`)은 지우지 않는다. 간격을 바꿨다고 방금 처리한 알림이
   * 되살아나면 안 되기 때문. 새 간격은 다음 배수부터 적용된다.
   */
  const reloadBehaviors = useCallback(async () => {
    behaviorsRef.current = await db.loadBehaviors()
    console.log(
      '[overlay] 행동 반영',
      behaviorsRef.current.map((b) => `${b.id}:${intervalMinutes(b)}m:${b.enabled ? 'on' : 'off'}`)
    )
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

        // 카드가 떠 있으면(카운트다운 포함) 덮어쓰지 않고 큐에 재운다. **무음** —
        // 사용자는 이미 카드를 보고 있고, 여기서 소리가 나면 지금 하는 행동을 방해한다.
        // 나머지 due 도 계속 훑는다: 긴 카운트다운 중에는 여러 건이 도래할 수 있다.
        if (activeRef.current) {
          const { queue, dropped } = enqueueOccurrence(queueRef.current, occurrence)
          queueRef.current = queue
          void invoke('log_debug', {
            line:
              `queue push ${id} n=${queue.length}` +
              (dropped.length > 0 ? ` dropped=${dropped.map(occurrenceId).join(' ')}` : ''),
          })
          continue
        }

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
        queueRef.current = []
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
      // 대기 중이던 발화는 통째로 버린다. 세션이 끝났는데 "아까 왔어야 할 알림"을
      // 이제 와서 띄우면 그건 알림이 아니라 잔소리다 (기록도 남기지 않는다)
      if (queueRef.current.length > 0) {
        void invoke('log_debug', { line: `queue clear n=${queueRef.current.length}` })
      }
      queueRef.current = []
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
      // 세션 도중 지워진 행동도 기록에 남은 이름 스냅샷으로 표시한다
      const labels = new Map<string, string>()
      for (const log of logsRef.current) {
        if (log.behaviorLabel) labels.set(log.behaviorId, log.behaviorLabel)
      }
      for (const b of behaviorsRef.current) labels.set(b.id, `${b.emoji} ${b.label}`)

      console.log('[overlay] 세션 요약', stats)
      void invoke('log_overlay_action', {
        action: `summary worked=${stats.workedMs} total=${stats.overall.total} done=${stats.overall.done}`,
      })
      openCard({ kind: 'summary', stats, labels })
    },
    [hide, openCard]
  )

  useEffect(() => {
    const unlisteners = [
      listen<{ now: number }>('app://tick', (e) => onTick(e.payload.now)),
      listen<{ startedAt: number | null; endedAt: number | null }>('session://changed', (e) =>
        applySession(e.payload.startedAt, e.payload.endedAt)
      ),
      listen(db.SETTINGS_CHANGED, () => void reloadSettings()),
      listen(db.BEHAVIORS_CHANGED, () => void reloadBehaviors()),
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
      // `--debug-cmd behaviors-dump` — 스케줄러가 실제로 받는 목록
      listen('overlay://debug-behaviors-dump', () => {
        void db
          .summarizeBehaviors()
          .then((line) => invoke('log_debug', { line }))
          .catch((e) => invoke('log_debug', { line: `behaviors-dump 실패: ${e}` }))
      }),
      // `--debug-cmd behavior-add / behavior-delete / behavior-restore / set-interval / set-duration`
      listen<string>('overlay://debug-behavior', (e) => void debugBehavior(e.payload)),
      // `--debug-cmd queue-dump` — 지금 대기 중인 발화. 큐 적재가 눈에 보이는 유일한 창구다
      listen('overlay://debug-queue-dump', () => {
        void invoke('log_debug', { line: summarizeQueue(queueRef.current) })
      }),
      // `--debug-cmd set-sound:<on|off|0-100>` — 설정 창과 같은 저장·방송 경로
      listen<string>('overlay://debug-set-sound', (e) => {
        const arg = e.payload.trim()
        const volume = Number(arg)
        void db
          .loadSettings()
          .then((current) =>
            db.saveSettingsAndBroadcast(
              Number.isFinite(volume) && arg !== ''
                ? { ...current, soundVolume: volume }
                : { ...current, soundEnabled: arg !== 'off' }
            )
          )
          .then((saved) =>
            invoke('log_debug', {
              line: `settings sound=${saved.soundEnabled ? 'on' : 'off'} volume=${saved.soundVolume}`,
            })
          )
          .catch((err) => invoke('log_debug', { line: `set-sound 실패: ${err}` }))
      }),
      // `--debug-cmd set-theme:<light|dark|system>`
      listen<string>('overlay://debug-set-theme', (e) => {
        void db
          .loadSettings()
          .then((current) =>
            db.saveSettingsAndBroadcast({
              ...current,
              theme: normalizeThemePreference(e.payload),
            })
          )
          .then((saved) => invoke('log_debug', { line: `settings theme=${saved.theme}` }))
          .catch((err) => invoke('log_debug', { line: `set-theme 실패: ${err}` }))
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
        await Promise.all([reloadSettings(), reloadBehaviors()])
      } catch (e) {
        console.error('[overlay] 설정·행동 로드 실패', e)
      }

      const startedAt = await invoke<number | null>('current_session')
      if (startedAt !== null && startedAt !== undefined) applySession(startedAt, null)
    })()

    return () => {
      unlisteners.forEach((p) => void p.then((fn) => fn()))
    }
  }, [onTick, applySession, openCard, dismiss, hide, reloadSettings, reloadBehaviors])

  const seconds = Math.ceil(remainingMs / 1000)

  return (
    // 창 전체는 투명. 카드 영역 밖은 그리지 않는다.
    <div className="overlay-root">
      {active && (
        <div
          ref={cardRef}
          className={`overlay-card${slidIn ? ' overlay-card--in' : ''}`}
          role="alert"
        >
          {active.kind === 'behavior' && (
            <BehaviorCard
              behavior={active.behavior}
              phase={phase}
              seconds={seconds}
              onDismiss={dismiss}
              onClose={hide}
            />
          )}

          {active.kind === 'idle' && (
            <>
              <div className="overlay-card__body">
                <span className="overlay-card__icon" aria-hidden="true">
                  {OVERLAY.IDLE_ICON}
                </span>
                <p className="overlay-card__message">{OVERLAY.IDLE_MESSAGE}</p>
              </div>
              <div className="overlay-card__actions">
                <Button
                  variant="primary"
                  onClick={() => {
                    void invoke('start_session_command')
                  }}
                >
                  {OVERLAY.IDLE_START}
                </Button>
                <Button variant="ghost" onClick={hide}>
                  {OVERLAY.IDLE_LATER}
                </Button>
              </div>
            </>
          )}

          {active.kind === 'summary' && (
            <SummaryCard stats={active.stats} labels={active.labels} onClose={hide} />
          )}
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
  onClose,
}: {
  behavior: Behavior
  phase: Phase
  seconds: number
  onDismiss: (action: CompletionAction) => void
  onClose: () => void
}) {
  // 스트레칭은 D2.9 부터 정적 message 대신 오늘의 동작(로테이션)을 보여준다.
  // 카드는 좁아서(540×139) 이름 + 방법 첫 줄까지만 — 전체는 [자세히]가 메인 창으로 보낸다.
  const rotation = behavior.id === STRETCH_ROTATION_ID ? actionAt(behavior.actionIndex) : null
  const message = rotation ? rotation.name : cardMessage(behavior)

  return (
    <>
      <div className="overlay-card__body">
        <span className="overlay-card__icon" aria-hidden="true">
          {behavior.emoji}
        </span>
        <p
          className={`overlay-card__message${
            phase === 'counting' ? ' overlay-card__message--count' : ''
          }`}
        >
          {phase === 'card'
            ? message
            : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
        </p>
      </div>

      {phase === 'card' && rotation && (
        <p className="overlay-card__note">{rotation.method[0]}</p>
      )}

      <div className="overlay-card__actions">
        {phase === 'card' ? (
          <>
            <Button variant="primary" onClick={() => onDismiss('done')}>
              {OVERLAY.ACTION_DONE}
            </Button>
            <Button onClick={() => onDismiss('snoozed')}>{OVERLAY.ACTION_SNOOZE}</Button>
            <Button variant="ghost" onClick={() => onDismiss('skipped')}>
              {OVERLAY.ACTION_SKIP}
            </Button>
            {rotation && (
              <Button
                variant="ghost"
                onClick={() => void invoke('show_action_detail', { actionId: rotation.id })}
              >
                {OVERLAY.ACTION_DETAIL}
              </Button>
            )}
          </>
        ) : (
          // 기록은 이미 'done' 으로 남았다. [중단]은 카운트다운만 멈춘다
          <Button variant="ghost" onClick={onClose}>
            {OVERLAY.COUNTDOWN_STOP}
          </Button>
        )}
      </div>
    </>
  )
}

function SummaryCard({
  stats,
  labels,
  onClose,
}: {
  stats: Stats
  labels: Map<string, string>
  onClose: () => void
}) {
  const recorded = stats.byBehavior.filter((s) => s.total > 0)

  return (
    <>
      <div className="overlay-card__body">
        <span className="overlay-card__icon" aria-hidden="true">
          {OVERLAY.SUMMARY_ICON}
        </span>
        <p className="overlay-card__message">
          {OVERLAY.SUMMARY_TITLE} · {OVERLAY.SUMMARY_WORKED} {formatDuration(stats.workedMs)}
        </p>
      </div>

      {recorded.length === 0 ? (
        <p className="overlay-card__note">{OVERLAY.SUMMARY_NO_RECORD}</p>
      ) : (
        <ul className="overlay-card__summary">
          {recorded.map((stat) => (
            <li key={stat.behaviorId}>
              <span>{labels.get(stat.behaviorId) ?? stat.behaviorId}</span>
              <span className="overlay-card__summary-rate">
                {formatRate(stat.rate)}
                <em>
                  {stat.done}/{stat.total}
                </em>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="overlay-card__actions">
        <Button variant="primary" onClick={onClose}>
          {OVERLAY.SUMMARY_CLOSE}
        </Button>
      </div>
    </>
  )
}
