import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'
import { type ActionCard, actionById } from '../../core/actionRotation'
import { computeNextOccurrences } from '../../core/scheduler'
import { DEFAULT_SETTINGS, type AppSettings } from '../../core/settings'
import { computeStats, type Range, type Stats } from '../../core/stats'
import type { Behavior, CompletionLog, Occurrence, WorkSession } from '../../core/types'
import * as db from '../../data/db'
import {
  formatClock,
  formatDuration,
  formatRate,
  last7DaysRange,
  todayRange,
} from '../../data/range'
import { MAIN } from '../../constants/strings'
import Button from '../../components/Button'
import Card from '../../components/Card'
import EmptyState from '../../components/EmptyState'

/**
 * DB 를 다시 읽는 주기. 통계 **표시**는 매 tick 다시 계산하지만(순수 함수라 공짜),
 * 원재료를 다시 읽을 이유는 드물다 — 세션·행동·기록 변화는 이벤트로 온다.
 */
const RELOAD_MS = 30_000

/** 예정 목록에 몇 건까지 보여줄지 */
const UPCOMING_COUNT = 5

/**
 * 예정 목록을 뽑을 구간 길이. 간격 상한이 8시간이라 12시간이면 어떤 설정에서도
 * 최소 한 건은 잡힌다. 순수 계산이고 상한(MAX_OCCURRENCES)이 있어 비용은 무시할 수준.
 */
const UPCOMING_HORIZON_MS = 12 * 60 * 60_000

interface Source {
  sessions: WorkSession[]
  logs: CompletionLog[]
  behaviors: Behavior[]
}

async function loadSource(now: number): Promise<Source> {
  const week = last7DaysRange(now)
  // 7일 구간 한 번만 읽고 오늘은 그 안에서 다시 계산한다 — 쿼리 왕복을 절반으로.
  const [sessions, logs, behaviors] = await Promise.all([
    db.loadSessions(week.from, week.to),
    db.loadLogs(week.from, week.to),
    db.loadBehaviors(),
  ])
  return { sessions, logs, behaviors }
}

export default function MainWindow() {
  const [source, setSource] = useState<Source | null>(null)
  const [session, setSession] = useState<WorkSession | null>(null)
  /** 오버레이 [자세히] → `windows::show_action_detail` 가 이 창을 띄우며 실어 보낸다 (D2.9) */
  const [detailAction, setDetailAction] = useState<ActionCard | null>(null)

  /**
   * "지금"은 Rust 의 1초 tick 이 준다. `Date.now()` 가 아닌 이유는 두 가지 —
   * 오버레이의 발화 판단과 **같은 시각**을 봐야 표시와 실제가 어긋나지 않고,
   * `--debug-cmd tick:` 의 가상 시각도 그대로 따라가야 자동 검증이 성립한다.
   * 첫 tick 이 오기 전 한 프레임만 벽시계로 채운다.
   */
  const [now, setNow] = useState(() => Date.now())
  const nowRef = useRef(now)

  /**
   * 백그라운드 안내 토스트 판단에만 쓴다. 화면에 그리는 값이 아니라서 상태로 두지 않는다.
   */
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS)

  const reload = useCallback(() => {
    loadSource(nowRef.current)
      .then(setSource)
      .catch((e) => console.error('[main] 데이터 로드 실패', e))
  }, [])

  // 세션 상태의 단일 출처는 Rust. 창이 만들어지기 전에 나간 이벤트를 놓칠 수 있어
  // 최초 1회는 직접 물어본다 (오버레이와 같은 패턴).
  const applySession = useCallback((startedAt: number | null) => {
    setSession(startedAt === null ? null : { id: `s-${startedAt}`, startedAt, endedAt: null })
  }, [])

  useEffect(() => {
    reload()
    invoke<number | null>('current_session')
      .then((startedAt) => applySession(startedAt ?? null))
      .catch((e) => console.error('[main] 세션 조회 실패', e))

    const timer = window.setInterval(reload, RELOAD_MS)
    const unlisteners = [
      listen<{ now: number }>('app://tick', (e) => {
        nowRef.current = e.payload.now
        // 트레이로 숨은 창까지 매초 리렌더할 이유는 없다. 다시 보일 때 따라잡는다.
        if (!document.hidden) setNow(e.payload.now)
      }),
      listen<{ startedAt: number | null }>('session://changed', (e) => {
        applySession(e.payload.startedAt)
        reload()
      }),
      listen(db.BEHAVIORS_CHANGED, reload),
    ]

    const onVisible = () => {
      if (document.hidden) return
      setNow(nowRef.current)
      reload()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      unlisteners.forEach((p) => void p.then((fn) => fn()))
    }
  }, [reload, applySession])

  useEffect(() => {
    const applySettings = (s: AppSettings) => {
      settingsRef.current = s
    }
    db.loadSettings().then(applySettings).catch((e) => console.error('[main] 설정 조회 실패', e))
    const unlisten = listen(db.SETTINGS_CHANGED, () => {
      db.loadSettings().then(applySettings).catch((e) => console.error('[main] 설정 조회 실패', e))
    })
    return () => void unlisten.then((fn) => fn())
  }, [])

  /** 오버레이 [자세히] — 동작 id 만 실려 온다. 방법 전체·시간·출처는 여기서 `actionById` 로 찾는다 */
  useEffect(() => {
    const unlisten = listen<string>('main://action-detail', (e) => {
      const action = actionById(e.payload)
      if (action) setDetailAction(action)
    })
    return () => void unlisten.then((fn) => fn())
  }, [])

  /**
   * 창을 처음 숨길 때(닫기 X, [백그라운드에서 실행] 버튼 — 둘 다 Rust 의 `windows::hide_main`
   * 한 곳으로 모여 `main://hidden` 을 낸다) 시스템 토스트로 한 번만 안내한다.
   *
   * Page Visibility(`document.hidden`/`visibilitychange`) 가 아니라 Rust 가 보내는 이벤트를 쓴다 —
   * 실측 결과 WebView2 는 `ShowWindow(SW_HIDE)` 로 숨겨도 `visibilitychange` 를 신뢰성 있게
   * 주지 않았다(오버레이가 raw Win32 로 숨어서 `is_visible()` 이 어긋나는 것과 같은 결의 문제,
   * `docs/decisions/0001`). 플래그는 세션이 아니라 **설치 전체에서 한 번**이라 앱 설정에 둔다
   * (`backgroundNoticeShown`).
   */
  useEffect(() => {
    const unlisten = listen('main://hidden', () => {
      if (settingsRef.current.backgroundNoticeShown) return
      // 권한 요청이 오래 걸려도 그 사이 두 번 뜨지 않도록 먼저 막아 둔다
      const next = { ...settingsRef.current, backgroundNoticeShown: true }
      settingsRef.current = next

      void (async () => {
        let granted = false
        try {
          granted = await isPermissionGranted()
          if (!granted) granted = (await requestPermission()) === 'granted'
          if (granted) {
            sendNotification({
              title: MAIN.BACKGROUND_NOTICE_TITLE,
              body: MAIN.BACKGROUND_NOTICE_BODY,
            })
          }
        } catch (e) {
          console.error('[main] 백그라운드 안내 실패', e)
        }
        void invoke('log_debug', { line: `background-notice granted=${granted}` })
        db.saveSettingsAndBroadcast(next).catch((e) => console.error('[main] 설정 저장 실패', e))
      })()
    })

    return () => void unlisten.then((fn) => fn())
  }, [])

  const behaviors = useMemo(() => source?.behaviors ?? [], [source])

  /**
   * 앞으로 뜰 알림. 오버레이가 실제로 띄우는 것과 **같은 순수 함수**를 같은 `now` 로 돌린다.
   *
   * 두 가지는 알 수 없다: 이미 띄운 건(오버레이의 firedRef)과 스누즈(오버레이가 들고 있다).
   * 그래서 여기 목록은 "정규 스케줄 예정표"다 — 방금 지나간 한 건이 잠깐 남아 있을 수 있다.
   */
  const upcoming = useMemo<Occurrence[]>(
    () =>
      session
        ? computeNextOccurrences(session, behaviors, now, UPCOMING_HORIZON_MS).slice(
            0,
            UPCOMING_COUNT
          )
        : [],
    [session, behaviors, now]
  )

  const view = useMemo(() => {
    if (!source) return null
    const ids = behaviors.map((b) => b.id)
    const stats = (range: Range) => computeStats(source.sessions, source.logs, now, range, ids)
    return { today: stats(todayRange(now)), week: stats(last7DaysRange(now)) }
  }, [source, behaviors, now])

  /**
   * 통계에 붙일 이름. 삭제된 행동은 목록에 없으므로 기록에 남긴 이름 스냅샷으로 채운다
   * (docs/decisions/0006). 그것도 없는 구버전 기록은 id 를 그대로 보여준다.
   */
  const labels = useMemo(() => {
    const map = new Map<string, string>()
    for (const log of source?.logs ?? []) {
      if (log.behaviorLabel) map.set(log.behaviorId, log.behaviorLabel)
    }
    for (const b of behaviors) map.set(b.id, `${b.emoji} ${b.label}`)
    return map
  }, [source, behaviors])

  /**
   * `--debug-cmd main-dump` — 화면에 그리고 있는 값 그대로를 stdout 으로 흘린다.
   * `dump` 의 `clock.now`·`elapsedMs` 와 대조하면 "타이머 표시값 = 실제 발화 시각"을
   * 클릭 없이 확인할 수 있다 (CLAUDE.md 「검증 정책」).
   */
  const shown = useRef({ now, session, upcoming })
  shown.current = { now, session, upcoming }

  useEffect(() => {
    const unlisten = listen('main://debug-dump', () => {
      const { now: at, session: s, upcoming: list } = shown.current
      const next = list[0]
      void invoke('log_debug', {
        line:
          `main now=${at} elapsedMs=${s ? at - s.startedAt : 'none'} ` +
          `next=${next ? `${next.behaviorId}@${next.dueAt}` : 'none'} ` +
          `remainingMs=${next ? next.dueAt - at : 'none'} upcoming=${list.length}`,
      })
    })
    return () => void unlisten.then((fn) => fn())
  }, [])

  const empty = view !== null && view.week.sessionCount === 0 && view.week.overall.total === 0

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="badge">{MAIN.PHASE_BADGE}</span>
          <h1>{MAIN.TITLE}</h1>
        </div>
        <div className="topbar__actions">
          <Button variant="secondary" onClick={() => invoke('hide_main_window')}>
            {MAIN.BACKGROUND_BUTTON}
          </Button>
          <Button size="sm" onClick={() => invoke('open_settings_window')}>
            {MAIN.OPEN_SETTINGS_BUTTON}
          </Button>
        </div>
      </header>

      {detailAction && (
        <ActionDetailCard action={detailAction} onClose={() => setDetailAction(null)} />
      )}

      <SessionPanel
        session={session}
        now={now}
        behaviors={behaviors}
        upcoming={upcoming}
        anyEnabled={behaviors.some((b) => b.enabled)}
      />

      {view === null ? (
        <EmptyState>…</EmptyState>
      ) : empty ? (
        <EmptyState>{MAIN.STATS_EMPTY}</EmptyState>
      ) : (
        <div className="stats">
          <StatsPanel
            title={MAIN.STATS_TODAY}
            stats={view.today}
            labels={labels}
            active={session !== null}
          />
          <StatsPanel title={MAIN.STATS_WEEK} stats={view.week} labels={labels} active={false} />
        </div>
      )}

      <div className="actions">
        <Button onClick={() => invoke('trigger_test_overlay')}>{MAIN.TEST_OVERLAY_BUTTON}</Button>
      </div>

      <footer className="footer">
        <p className="hint footer__notice">
          {/* 어절 중간 개행 방지(word-break: keep-all) + 문장 경계에서 자연스러운 개행 */}
          {MAIN.DESCRIPTION.split(/(?<=\.) /).map((sentence, i, all) => (
            <span key={i}>
              {sentence}
              {i < all.length - 1 && <br />}
            </span>
          ))}
        </p>
        <Button size="sm" onClick={() => invoke('quit_app')}>
          {MAIN.QUIT_BUTTON}
        </Button>
      </footer>
    </main>
  )
}

/**
 * 스트레칭 로테이션 상세(D2.9) — 오버레이 카드는 좁아서(540×139) 이름 + 방법 첫 줄만
 * 보여준다. 방법 전체·시간·출처는 여기서 원고(`src/constants/strings.ts` ACTION_CARDS)
 * 그대로 보여준다.
 */
function ActionDetailCard({ action, onClose }: { action: ActionCard; onClose: () => void }) {
  return (
    <Card as="section" className="action-detail">
      <div className="action-card__head">
        <h2>{action.name}</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {MAIN.ACTION_DETAIL_CLOSE}
        </Button>
      </div>
      <ul className="action-card__method">
        {action.method.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <p className="action-card__row">
        <span>{MAIN.ACTION_DETAIL_DURATION_LABEL}</span>
        <strong>{action.duration}</strong>
      </p>
      <p className="action-card__source">
        {MAIN.ACTION_DETAIL_SOURCE_LABEL}: {action.source}
      </p>
    </Card>
  )
}

function SessionPanel({
  session,
  now,
  behaviors,
  upcoming,
  anyEnabled,
}: {
  session: WorkSession | null
  now: number
  behaviors: Behavior[]
  upcoming: Occurrence[]
  anyEnabled: boolean
}) {
  const active = session !== null
  const [next, ...rest] = upcoming
  const nextBehavior = next && behaviors.find((b) => b.id === next.behaviorId)

  return (
    <Card as="section" className="session">
      <div className="session__head">
        <div>
          <span className="session__state">
            {active ? MAIN.SESSION_ELAPSED : MAIN.SESSION_IDLE_TITLE}
          </span>
          <strong className="session__elapsed">
            {active ? formatClock(now - session.startedAt) : '—'}
          </strong>
        </div>

        {/* 트레이 메뉴와 완전히 같은 커맨드. 어느 쪽에서 눌러도 session://changed 로 합쳐진다 */}
        <Button
          variant={active ? 'secondary' : 'primary'}
          onClick={() => invoke(active ? 'end_session_command' : 'start_session_command')}
        >
          {active ? MAIN.SESSION_END : MAIN.SESSION_START}
        </Button>
      </div>

      {!active ? (
        <p className="hint">{MAIN.SESSION_IDLE_HINT}</p>
      ) : !nextBehavior ? (
        <p className="hint">{anyEnabled ? '…' : MAIN.NEXT_NONE}</p>
      ) : (
        <>
          <div className="next">
            <span className="next__label">{MAIN.NEXT_TITLE}</span>
            <span className="next__name">
              {nextBehavior.emoji} {nextBehavior.label}
            </span>
            <span className="next__time">{formatClock(next.dueAt - now, 'ceil')}</span>
          </div>

          {rest.length > 0 && (
            <div className="upcoming">
              <span className="upcoming__label">{MAIN.UPCOMING_TITLE}</span>
              <ul>
                {rest.map((o) => {
                  const b = behaviors.find((x) => x.id === o.behaviorId)
                  return (
                    <li key={`${o.behaviorId}@${o.dueAt}`}>
                      <span>
                        {b?.emoji} {b?.label ?? o.behaviorId}
                      </span>
                      <span className="upcoming__time">{formatClock(o.dueAt - now, 'ceil')}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function StatsPanel({
  title,
  stats,
  labels,
  active,
}: {
  title: string
  stats: Stats
  labels: Map<string, string>
  active: boolean
}) {
  return (
    <Card as="section" className="panel">
      <header>
        <h2 className="section__title">{title}</h2>
        {active && <span className="live">{MAIN.STATS_ACTIVE}</span>}
      </header>

      <dl className="totals">
        <div>
          <dt>{MAIN.STATS_WORKED}</dt>
          <dd>{formatDuration(stats.workedMs)}</dd>
        </div>
        <div>
          <dt>{MAIN.STATS_SESSIONS}</dt>
          <dd>
            {stats.sessionCount}
            {MAIN.STATS_SESSION_UNIT}
          </dd>
        </div>
        <div>
          <dt>{MAIN.STATS_RATE}</dt>
          <dd>{formatRate(stats.overall.rate)}</dd>
        </div>
      </dl>

      <ul className="behavior-stats">
        {stats.byBehavior.map((stat) => (
          <li key={stat.behaviorId}>
            <span>{labels.get(stat.behaviorId) ?? stat.behaviorId}</span>
            <span className="behavior-stats__value">
              {formatRate(stat.rate)}
              <em>
                {stat.done}/{stat.total}
              </em>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
