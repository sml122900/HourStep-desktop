import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { computeNextOccurrences } from '../../core/scheduler'
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

  /**
   * "지금"은 Rust 의 1초 tick 이 준다. `Date.now()` 가 아닌 이유는 두 가지 —
   * 오버레이의 발화 판단과 **같은 시각**을 봐야 표시와 실제가 어긋나지 않고,
   * `--debug-cmd tick:` 의 가상 시각도 그대로 따라가야 자동 검증이 성립한다.
   * 첫 tick 이 오기 전 한 프레임만 벽시계로 채운다.
   */
  const [now, setNow] = useState(() => Date.now())
  const nowRef = useRef(now)

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
        <button className="ghost" onClick={() => invoke('open_settings_window')}>
          {MAIN.OPEN_SETTINGS_BUTTON}
        </button>
      </header>

      <SessionPanel
        session={session}
        now={now}
        behaviors={behaviors}
        upcoming={upcoming}
        anyEnabled={behaviors.some((b) => b.enabled)}
      />

      {view === null ? (
        <p className="desc">…</p>
      ) : empty ? (
        <p className="desc">{MAIN.STATS_EMPTY}</p>
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
        <button onClick={() => invoke('trigger_test_overlay')}>{MAIN.TEST_OVERLAY_BUTTON}</button>
        <button onClick={() => invoke('hide_main_window')}>{MAIN.HIDE_BUTTON}</button>
      </div>

      <p className="hint">{MAIN.DESCRIPTION}</p>
    </main>
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
    <section className="session">
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
        <button
          className={`session__toggle${active ? ' session__toggle--end' : ''}`}
          onClick={() => invoke(active ? 'end_session_command' : 'start_session_command')}
        >
          {active ? MAIN.SESSION_END : MAIN.SESSION_START}
        </button>
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
    </section>
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
    <section className="panel">
      <header>
        <h2>{title}</h2>
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
    </section>
  )
}
