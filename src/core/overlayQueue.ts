/**
 * 발화 큐 — IO 없는 순수 모듈. React·Tauri import 금지.
 *
 * 오버레이 창은 **하나뿐**이다. 카드가 떠 있는 동안 다음 알림이 도래하면 그대로 덮어써서
 * 앞의 카드가 사라진다 — 사용자가 스트레칭을 세고 있는데 물마시기가 화면을 빼앗는다.
 *
 * 그래서 겹치는 발화를 **병합하지 않고 직렬화한다**: 뜬 카드가 끝날 때까지 큐에 재우고,
 * 끝나면 한 건씩 꺼내 띄운다 (근거: `docs/decisions/0009`). 병합(둘을 한 장에 합치기)을
 * 고르지 않은 이유는 두 행동이 실제로 둘 다 해야 할 일이고, 합치면 기록도 하나로 뭉개지기
 * 때문이다. 스누즈는 이 큐와 무관하다 — 스케줄러 경로로 다시 도래한다.
 *
 * 큐에 든 항목은 **원래 dueAt 을 유지한다.** 지연은 사실이고, 그 사실을 지우지 않는다.
 * 반대로 꺼낼 때 「밀린 알림 소진」(STALE_MS) 을 다시 적용하지도 않는다 — 밀린 이유가
 * 앞 카드였다면 그건 사용자가 성실히 휴식한 결과지 절전으로 앱이 자고 있던 게 아니다.
 */

import { occurrenceId } from './scheduler'
import type { Occurrence } from './types'

/**
 * 큐 상한. 넘으면 **오래된 것부터** 버린다.
 *
 * 5건이 쌓였다는 건 이미 한참 밀렸다는 뜻이고, 그때 오래된 것을 붙잡아 봐야 "10분 전에
 * 왔어야 할 알림"만 보여줄 뿐이다. 버린 것은 기록하지 않는다 — 사용자가 건너뛴 게 아니라
 * 앱이 못 보여준 것이라 `skipped` 로 세면 실천율이 사용자 탓처럼 왜곡된다 (로그만 남긴다).
 */
export const MAX_QUEUED = 5

export interface EnqueueResult {
  queue: Occurrence[]
  /** 상한을 넘겨 버려진 것. 호출부가 로그로 남긴다 (조용히 사라지면 안 된다) */
  dropped: Occurrence[]
}

/**
 * 카드가 떠 있는 동안 도래한 발화를 큐 뒤에 넣는다.
 *
 * 같은 occurrence(`behaviorId@dueAt`)가 이미 들어 있으면 무시한다 — 호출부가 tick 마다
 * 예정표를 다시 계산하므로 같은 건이 두 번 들어오는 걸 여기서도 막아 둔다.
 */
export function enqueueOccurrence(
  queue: readonly Occurrence[],
  occurrence: Occurrence,
  limit = MAX_QUEUED
): EnqueueResult {
  const id = occurrenceId(occurrence)
  if (queue.some((o) => occurrenceId(o) === id)) return { queue: [...queue], dropped: [] }

  const next = [...queue, occurrence]
  if (limit <= 0) return { queue: [], dropped: next }

  const overflow = Math.max(0, next.length - limit)
  return { queue: next.slice(overflow), dropped: next.slice(0, overflow) }
}

/** 큐에서 다음 한 건을 꺼낸다. 비어 있으면 `next` 가 null (호출부는 그냥 카드를 닫는다) */
export function dequeueOccurrence(queue: readonly Occurrence[]): {
  next: Occurrence | null
  rest: Occurrence[]
} {
  if (queue.length === 0) return { next: null, rest: [] }
  return { next: queue[0], rest: queue.slice(1) }
}

/** 큐 상태 한 줄 요약 (`--debug-cmd queue-dump`). 검증이 stdout 을 파싱한다. */
export function summarizeQueue(queue: readonly Occurrence[]): string {
  return `queue n=${queue.length} ${queue.map(occurrenceId).join(' ')}`.trimEnd()
}
