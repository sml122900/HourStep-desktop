/**
 * 스케줄러 — IO 없는 순수 모듈. React·Tauri import 금지.
 *
 * 모든 계산은 **세션 시작 시각 기준 경과시간**으로만 한다. 벽시계·타임존·자정을
 * 참조하지 않으므로 자정을 넘는 세션도 특별 처리가 필요 없다.
 *
 * `Date.now()` 를 절대 호출하지 않는다 — `now` 는 항상 인자로 주입된다.
 * (모바일 Expo 와 공유 전제, 그리고 테스트·가상시각 주입을 같은 경로로 태우기 위해)
 */

import type { Behavior, Occurrence, WorkSession } from './types'

/** 스누즈 재삽입 간격 */
export const SNOOZE_MS = 3 * 60_000

/** 스누즈가 정규 알림과 이만큼 이내로 겹치면 정규 것만 남긴다 */
export const MERGE_WINDOW_MS = 5 * 60_000

/** 폭주 방지 상한. everyMs 가 비정상적으로 작아도 앱이 멈추지 않게 한다 */
const MAX_OCCURRENCES = 1000

/** CompletionLog 가 참조할 안정적인 식별자. 같은 (행동, 예정시각) 이면 항상 같다 */
export function occurrenceId(o: Occurrence): string {
  return `${o.behaviorId}@${o.dueAt}`
}

/**
 * `[now, now + horizonMs]` 구간에 예정된 Occurrence 를 dueAt 오름차순으로 돌려준다.
 *
 * - 이미 지난 것(dueAt < now)은 제외한다
 * - `session.endedAt !== null` 이면 빈 배열
 * - `enabled: false` 행동은 제외
 * - 스누즈가 같은 행동의 정규 알림과 `MERGE_WINDOW_MS` 이내로 겹치면 정규 것만 남긴다
 *
 * @param horizonMs `now` 로부터의 조회 길이(ms). 0이면 정확히 now 시점만 본다.
 */
export function computeNextOccurrences(
  session: WorkSession,
  behaviors: Behavior[],
  now: number,
  horizonMs: number,
  snoozes: Occurrence[] = []
): Occurrence[] {
  if (session.endedAt !== null) return []

  const from = Math.max(now, session.startedAt)
  const until = now + horizonMs
  if (until < from) return []

  const regular: Occurrence[] = []

  for (const behavior of behaviors) {
    if (!behavior.enabled) continue

    if (behavior.rule.kind === 'atElapsed') {
      regular.push({
        behaviorId: behavior.id,
        dueAt: session.startedAt + behavior.rule.atMs,
        origin: 'regular',
      })
      continue
    }

    const every = behavior.rule.everyMs
    if (every <= 0) continue

    // from 이후로 처음 오는 배수부터. k=0 (세션 시작 시점) 은 알림 대상이 아니다.
    const firstK = Math.max(1, Math.ceil((from - session.startedAt) / every))
    for (let k = firstK; session.startedAt + k * every <= until; k++) {
      if (regular.length >= MAX_OCCURRENCES) break
      regular.push({ behaviorId: behavior.id, dueAt: session.startedAt + k * every, origin: 'regular' })
    }
  }

  const inWindow = (o: Occurrence) => o.dueAt >= from && o.dueAt <= until

  const keptRegular = regular.filter(inWindow)

  // 병합 판정은 **뒤쪽 방향으로만** 본다. 이미 지나간 정규 알림과 겹치는 건 병합이 아니다 —
  // 30분 알림을 스누즈하면 33분이 되는데, 그걸 "30분 것과 3분 차이"라고 지워버리면
  // 스누즈가 통째로 사라진다. CLAUDE.md 원문도 "**다음** 정규 알림과 5분 이내".
  const mergedIntoRegular = (s: Occurrence) =>
    keptRegular.some(
      (r) =>
        r.behaviorId === s.behaviorId &&
        r.dueAt >= s.dueAt &&
        r.dueAt - s.dueAt <= MERGE_WINDOW_MS
    )

  const keptSnoozes = snoozes.filter((s) => inWindow(s) && !mergedIntoRegular(s))

  return [...keptRegular, ...keptSnoozes].sort((a, b) => a.dueAt - b.dueAt)
}
