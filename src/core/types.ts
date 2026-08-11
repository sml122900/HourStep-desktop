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

/**
 * 이 행동의 문구가 어디서 왔는가.
 *
 * `'ai'` 는 D2.6 「AI로 루틴 찾기」로 가져온 것 — 우리가 지어낸 문구가 아니라 사용자가
 * 붙여넣고 확인한 문구라는 표시다. 내장 3종 여부는 `isBuiltin` 이 따로 들고 있으므로
 * 여기에 `'builtin'` 을 두지 않는다 (같은 사실을 두 곳에 적으면 어긋난다).
 */
export type BehaviorSource = 'user' | 'ai'

export interface Behavior {
  id: string
  label: string
  emoji: string
  /** 카드에 띄울 문구. 사용자가 직접 쓴다 (비면 label 을 대신 쓴다) */
  message: string
  rule: BehaviorRule
  /** MVP는 card만 구현 */
  intensity: 'toast' | 'card' | 'fullscreen'
  enabled: boolean
  /**
   * 이 행동을 하는 데 걸리는 시간(초).
   *
   * - `0` = 즉시 행동(물 한 잔). [완료]를 누르면 카드가 바로 닫힌다.
   * - `> 0` = 지속 행동(스트레칭·눈감기). [완료]가 카운트다운을 시작하고, 끝나면 카드가 스스로 닫힌다.
   *
   * D2 의 「완료 후 1분 카운트다운 제안」이 쓰던 하드코딩 60초를 대체한다 — 행동마다 다르다.
   */
  durationSec: number
  /**
   * 내장 기본 3종 표시. 「기본값 복원」의 대상이고, 향후 근거 기반 프로토콜을 붙일 자리다.
   * 사용자가 편집·삭제할 수 있고 그래도 플래그는 유지된다.
   */
  isBuiltin: boolean
  /** 문구의 출처. 설정 목록에서 AI 유래 행동을 구분해 보여준다 */
  source: BehaviorSource
  /** 목록 표시 순서. 오름차순, 0부터 연속 */
  sortOrder: number
  /**
   * 동작 로테이션의 마지막 인덱스 (D2.9). 지금은 내장 스트레칭(`id === 'stretch'`)만 쓴다 —
   * 발화마다 `src/core/actionRotation.ts` 의 다음 동작으로 전진하고 DB 에 남아 세션을 넘어 이어진다.
   * 그 외 행동에는 의미 없는 값이라 항상 0 이다.
   */
  actionIndex: number
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
  /**
   * 기록 시점의 행동 이름 스냅샷. 행동이 삭제·개명돼도 과거 통계에 이름을 붙일 수 있다
   * (docs/decisions/0006). 구버전 기록에는 없으므로 optional.
   */
  behaviorLabel?: string
}
