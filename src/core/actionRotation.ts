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

/** 기본값 — enabledIds 를 안 주면 예전(D2.9)과 동일하게 8개 전부 대상이다 */
const ALL_IDS = new Set<string>(ROTATION_ORDER)

/** 인덱스가 가리키는 오늘의 동작. 그 자리가 꺼져 있으면(D2.10) 다음 켜진 동작까지 민다. */
export function actionAt(index: number, enabledIds: ReadonlySet<string> = ALL_IDS): ActionCard {
  const n = ACTION_ROTATION.length
  let i = wrap(index)
  for (let step = 0; step < n; step++) {
    if (enabledIds.has(ACTION_ROTATION[i].id)) return ACTION_ROTATION[i]
    i = (i + 1) % n
  }
  // 전부 꺼진 손상 상태 — 정상 경로로는 안 온다(호출부가 최소 1개를 보장한다). 안전망만 둔다.
  return ACTION_ROTATION[wrap(index)]
}

/** id(A1~C2)로 찾는다. 오버레이의 [자세히]가 메인 창에 id 만 실어 보낸다 */
export function actionById(id: string): ActionCard | undefined {
  return ACTION_ROTATION.find((a) => a.id === id)
}

/**
 * 다음 발화에 저장할 인덱스. 꺼진 동작은 건너뛴다(D2.10) — 순서 자체는 그대로 두고
 * 골라내기만 한다("순서는 기존 고정 순서에서 disabled만 건너뜀"). 끝까지 가면 처음으로 순환.
 */
export function nextActionIndex(index: number, enabledIds: ReadonlySet<string> = ALL_IDS): number {
  const n = ACTION_ROTATION.length
  let i = wrap(index)
  for (let step = 0; step < n; step++) {
    i = (i + 1) % n
    if (enabledIds.has(ACTION_ROTATION[i].id)) return i
  }
  return wrap(index) // 전부 꺼진 손상 상태 — 안전망
}

/** D2.10 — 동작 하나의 켬/끔. `action_prefs` 테이블 한 행과 1:1 */
export interface ActionPref {
  id: string
  enabled: boolean
}

/** 지금 켜진 동작 id 만 골라 담는다. `actionAt`/`nextActionIndex` 에 그대로 넘긴다. */
export function enabledActionIds(prefs: readonly ActionPref[]): Set<string> {
  return new Set(prefs.filter((p) => p.enabled).map((p) => p.id))
}

/**
 * id 를 지금 끌 수 있는가 — **최소 1개 강제**의 판단 함수. 이미 꺼져 있는 동작을 다시 끄는 건
 * 항상 허용(no-op)이다. 판단 기준은 "나 말고 켜진 게 하나라도 있는가" — 그래야 켜진 게
 * 정확히 1개일 때 그 마지막 하나만 막힌다.
 */
export function canDisable(prefs: readonly ActionPref[], id: string): boolean {
  return prefs.some((p) => p.id !== id && p.enabled)
}

/**
 * 저장돼 있던(혹은 방금 입력된) 동작 선택 값을 신뢰 가능한 형태로 만든다.
 * `normalizeBehaviors` 와 같은 성격 — 설정 창(사용자 입력)과 DB(구버전·손상) 둘 다
 * 신뢰 경계다. `ROTATION_ORDER` 에 없는 id 는 버리고, 없는 id 는 기본값(켬)으로 채운다.
 * 전부 꺼진 손상 상태면 첫 항목을 강제로 켠다 — 최소 1개 원칙은 저장 단계에서도 지킨다.
 */
export function normalizeActionPrefs(raws: readonly Partial<ActionPref>[]): ActionPref[] {
  const byId = new Map(
    raws.filter((r): r is Partial<ActionPref> & { id: string } => typeof r.id === 'string').map((r) => [r.id, r])
  )
  const out = ROTATION_ORDER.map((id) => ({
    id,
    enabled: byId.get(id)?.enabled !== false,
  }))
  if (!out.some((p) => p.enabled)) out[0] = { ...out[0], enabled: true }
  return out
}
