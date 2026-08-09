/**
 * 초기 시드 루틴 — IO 없는 순수 모듈.
 *
 * D2.5 부터 **런타임 소스는 DB(behaviors 테이블)** 다. 이 파일은
 * ① 최초 기동 시 심을 값 ② 「기본값 복원」이 되돌릴 값 두 가지 용도로만 쓴다.
 * 지금 화면에 뜨는 행동을 알고 싶으면 `src/data/db.ts` 의 `loadBehaviors()` 를 봐야 한다.
 *
 * 카드 문구는 여기 적지 않고 `src/constants/strings.ts` 에서 가져온다 (CLAUDE.md 규칙 8).
 * 시드된 뒤에는 사용자가 직접 고칠 수 있는 **데이터**가 되므로, strings.ts 의 값은
 * "처음에 심을 문구"이자 「기본값 복원」이 되돌릴 문구라는 뜻이다.
 */

import { BEHAVIOR_MESSAGE } from '../constants/strings'
import type { Behavior } from './types'

const MIN = 60_000

export const SEED_BEHAVIORS: readonly Behavior[] = [
  {
    id: 'stretch',
    label: '스트레칭',
    emoji: '🧘',
    message: BEHAVIOR_MESSAGE.stretch,
    rule: { kind: 'interval', everyMs: 50 * MIN },
    intensity: 'card',
    enabled: true,
    // CLAUDE.md 프리셋: "완료 시 1분 카운트다운"
    durationSec: 60,
    isBuiltin: true,
    source: 'user',
    sortOrder: 0,
  },
  {
    id: 'water',
    label: '물마시기',
    emoji: '💧',
    message: BEHAVIOR_MESSAGE.water,
    rule: { kind: 'interval', everyMs: 30 * MIN },
    intensity: 'card',
    enabled: true,
    // 물 한 잔은 마시는 데 시간이 걸리는 행동이 아니다 — [완료]를 누르면 바로 끝난다
    durationSec: 0,
    isBuiltin: true,
    source: 'user',
    sortOrder: 1,
  },
  {
    id: 'eyes',
    label: '눈휴식',
    emoji: '👀',
    message: BEHAVIOR_MESSAGE.eyes,
    rule: { kind: 'interval', everyMs: 60 * MIN },
    intensity: 'card',
    enabled: true,
    // 「눈감고 1분」이 행동 정의 자체다 (CLAUDE.md 시드 루틴)
    durationSec: 60,
    isBuiltin: true,
    source: 'user',
    sortOrder: 2,
  },
]

/** 시드 사본. 호출부가 자유롭게 변형해도 원본이 오염되지 않는다. */
export function seedBehaviors(): Behavior[] {
  return SEED_BEHAVIORS.map((b) => ({ ...b, rule: { ...b.rule } }))
}
