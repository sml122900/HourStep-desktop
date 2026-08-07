import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { PRESET_BEHAVIORS } from '../../core/presets'
import { computeStats, type Range, type Stats } from '../../core/stats'
import * as db from '../../data/db'
import { formatDuration, formatRate, last7DaysRange, todayRange } from '../../data/range'
import { MAIN } from '../../constants/strings'

/** 창이 떠 있는 동안의 갱신 주기. 세션 시작/종료는 이벤트로 즉시 반영되므로 느슨해도 된다. */
const REFRESH_MS = 30_000

interface View {
  today: Stats
  week: Stats
  sessionActive: boolean
}

const BEHAVIOR_IDS = PRESET_BEHAVIORS.map((b) => b.id)

async function loadView(): Promise<View> {
  // "지금"은 통계 표시용이라 실시간 벽시계를 쓴다. 스케줄 계산(core)만 주입 규칙 대상이다.
  const now = Date.now()
  const week = last7DaysRange(now)
  const today = todayRange(now)

  // 7일 구간 한 번만 읽고 오늘은 그 안에서 다시 계산한다 — 쿼리 왕복을 절반으로.
  const [sessions, logs, current] = await Promise.all([
    db.loadSessions(week.from, week.to),
    db.loadLogs(week.from, week.to),
    invoke<number | null>('current_session'),
  ])

  const stats = (range: Range) => computeStats(sessions, logs, now, range, BEHAVIOR_IDS)
  return { today: stats(today), week: stats(week), sessionActive: current !== null }
}

export default function MainWindow() {
  const [view, setView] = useState<View | null>(null)

  const refresh = useCallback(() => {
    loadView()
      .then(setView)
      .catch((e) => console.error('[main] 통계 로드 실패', e))
  }, [])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, REFRESH_MS)
    const unlisten = listen('session://changed', refresh)
    return () => {
      window.clearInterval(timer)
      void unlisten.then((fn) => fn())
    }
  }, [refresh])

  const empty = view !== null && view.week.sessionCount === 0 && view.week.overall.total === 0

  return (
    <main className="shell">
      <span className="badge">{MAIN.PHASE_BADGE}</span>
      <h1>{MAIN.TITLE}</h1>

      {view === null ? (
        <p className="desc">…</p>
      ) : empty ? (
        <p className="desc">{MAIN.STATS_EMPTY}</p>
      ) : (
        <div className="stats">
          <StatsPanel title={MAIN.STATS_TODAY} stats={view.today} active={view.sessionActive} />
          <StatsPanel title={MAIN.STATS_WEEK} stats={view.week} active={false} />
        </div>
      )}

      <div className="actions">
        <button onClick={() => invoke('trigger_test_overlay')}>{MAIN.TEST_OVERLAY_BUTTON}</button>
        <button onClick={() => invoke('open_settings_window')}>{MAIN.OPEN_SETTINGS_BUTTON}</button>
        <button onClick={() => invoke('hide_main_window')}>{MAIN.HIDE_BUTTON}</button>
      </div>

      <p className="hint">{MAIN.DESCRIPTION}</p>
    </main>
  )
}

function StatsPanel({ title, stats, active }: { title: string; stats: Stats; active: boolean }) {
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
        {stats.byBehavior.map((stat) => {
          const behavior = PRESET_BEHAVIORS.find((b) => b.id === stat.behaviorId)
          return (
            <li key={stat.behaviorId}>
              <span>
                {behavior ? `${behavior.emoji} ${behavior.label}` : stat.behaviorId}
              </span>
              <span className="behavior-stats__value">
                {formatRate(stat.rate)}
                <em>
                  {stat.done}/{stat.total}
                </em>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
