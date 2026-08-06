/**
 * 도메인 타입 — IO 없는 순수 모듈.
 * CLAUDE.md 코딩 규칙: src/core/ 아래는 React·Tauri import 금지 (eslint 강제).
 *
 * 시각은 전부 epoch ms (number). Date 객체를 쓰지 않는 이유는 모바일(Expo)과
 * 직렬화 경계를 공유하기 때문 — JSON 왕복에서 타입이 안 깨진다.
 */

export interface WorkSession {
  id: string
  startedAt: number
  /** 진행 중이면 null */
  endedAt: number | null
}

export type BehaviorRule =
  /** 세션 시작 기준 N ms 간격. 첫 발화는 startedAt + everyMs (0분에는 안 뜬다) */
  | { kind: 'interval'; everyMs: number }
  /** 세션 경과 특정 시점 1회 */
  | { kind: 'atElapsed'; atMs: number }

export interface Behavior {
  id: string
  label: string
  emoji: string
  rule: BehaviorRule
  /** MVP는 card만 구현 */
  intensity: 'toast' | 'card' | 'fullscreen'
  enabled: boolean
  /** 완료 후 제안할 카운트다운 길이. 없으면 제안하지 않는다 */
  countdownMs?: number
}

export interface Occurrence {
  behaviorId: string
  dueAt: number
  origin: 'regular' | 'snooze'
}

export type CompletionAction = 'done' | 'snoozed' | 'skipped'

export interface CompletionLog {
  occurrenceId: string
  behaviorId: string
  action: CompletionAction
  at: number
}
