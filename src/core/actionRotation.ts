/**
 * 스트레칭 카드의 동작 로테이션 — IO 없는 순수 모듈. React·Tauri import 금지.
 *
 * D2.9: 발화마다 다음 동작으로 넘어간다 (같은 동작만 반복하면 질린다 — 동작 카드
 * 원고 「배치 제안」). 순서·문구의 단일 출처는 `src/constants/strings.ts` 의
 * `ACTION_CARDS`(원고 그대로) 다. 여기서는 순서와 전진 규칙만 다룬다.
 *
 * 상태(마지막 인덱스)는 `Behavior.actionIndex` 에 실려 DB 를 왕복한다 — 세션이 끝나도,
 * 앱을 재시작해도 이어진다. 지금은 내장 스트레칭(`id === 'stretch'`)만 쓴다.
 */

import { ACTION_CARDS } from '../constants/strings'

export interface ActionCard {
  id: string
  name: string
  method: readonly string[]
  duration: string
  source: string
}

/** 동작 카드 원고 「배치 제안」의 순서 그대로: 일어나기·목·손목을 고루 섞는다 */
export const ROTATION_ORDER = ['A1', 'B1', 'B2', 'C1', 'A2', 'B3', 'B4', 'C2'] as const

export const ACTION_ROTATION: readonly ActionCard[] = ROTATION_ORDER.map((id) => ({
  id,
  ...ACTION_CARDS[id],
}))

/** 인덱스를 로테이션 길이 안으로 접는다. 음수·범위 밖 저장값(손상)도 안전하게 받는다. */
function wrap(index: number): number {
  const n = ACTION_ROTATION.length
  if (!Number.isFinite(index)) return 0
  return ((Math.trunc(index) % n) + n) % n
}

/** 인덱스가 가리키는 오늘의 동작 */
export function actionAt(index: number): ActionCard {
  return ACTION_ROTATION[wrap(index)]
}

/** id(A1~C2)로 찾는다. 오버레이의 [자세히]가 메인 창에 id 만 실어 보낸다 */
export function actionById(id: string): ActionCard | undefined {
  return ACTION_ROTATION.find((a) => a.id === id)
}

/** 다음 발화에 저장할 인덱스. 끝까지 가면 처음으로 돌아간다(순환) */
export function nextActionIndex(index: number): number {
  return (wrap(index) + 1) % ACTION_ROTATION.length
}
