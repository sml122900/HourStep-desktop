/**
 * 벽시계 기준 조회 구간 계산.
 *
 * `src/core/` 에 두지 않는 이유: "오늘 0시" 는 로컬 타임존이 필요해서 순수하지 않다.
 * 코어의 통계 함수는 epoch ms 구간만 받고, 그 구간을 만드는 책임이 여기 있다.
 */

import type { Range } from '../core/stats'

const DAY_MS = 24 * 60 * 60_000

function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 오늘 0시 ~ 내일 0시 */
export function todayRange(now: number): Range {
  const from = startOfLocalDay(now)
  // DST 로 하루가 23/25시간일 수 있으므로 +DAY_MS 가 아니라 날짜를 더해 다시 계산한다
  const next = new Date(from)
  next.setDate(next.getDate() + 1)
  return { from, to: next.getTime() }
}

/** 오늘 포함 최근 7일 (6일 전 0시 ~ 내일 0시) */
export function last7DaysRange(now: number): Range {
  const today = todayRange(now)
  const start = new Date(today.from)
  start.setDate(start.getDate() - 6)
  return { from: start.getTime(), to: today.to }
}

/** 밀리초를 "3시간 20분" 꼴로. 1분 미만이면 "0분". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}분`
  if (minutes === 0) return `${hours}시간`
  return `${hours}시간 ${minutes}분`
}

/** 실천율을 "75%" 로. 기록이 없으면(null) "—". */
export function formatRate(rate: number | null): string {
  if (rate === null) return '—'
  return `${Math.round(rate * 100)}%`
}

export { DAY_MS }
