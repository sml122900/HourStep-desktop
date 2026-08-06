/**
 * 내장 프리셋 루틴 (MVP 1종) — IO 없는 순수 모듈.
 * 표시 문구는 여기 두지 않는다. UI 문구는 src/constants/strings.ts (CLAUDE.md 규칙 8).
 */

import type { Behavior } from './types'

const MIN = 60_000

export const PRESET_BEHAVIORS: Behavior[] = [
  {
    id: 'stretch',
    label: '스트레칭',
    emoji: '🧘',
    rule: { kind: 'interval', everyMs: 50 * MIN },
    intensity: 'card',
    enabled: true,
    // CLAUDE.md 프리셋: "완료 시 1분 카운트다운 제안"
    countdownMs: 1 * MIN,
  },
  {
    id: 'water',
    label: '물마시기',
    emoji: '💧',
    rule: { kind: 'interval', everyMs: 30 * MIN },
    intensity: 'card',
    enabled: true,
  },
  {
    id: 'eyes',
    label: '눈휴식',
    emoji: '👀',
    rule: { kind: 'interval', everyMs: 60 * MIN },
    intensity: 'card',
    enabled: true,
  },
]

export function findBehavior(id: string): Behavior | undefined {
  return PRESET_BEHAVIORS.find((b) => b.id === id)
}
