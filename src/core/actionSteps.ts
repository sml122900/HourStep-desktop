/**
 * 카운트다운 중 동작 단계(D2.11) — IO 없는 순수 모듈. React·Tauri import 금지.
 *
 * 원고(`ACTION_CARDS[id].steps`, `src/constants/strings.ts`)는 v4 기본값(60초) 기준으로
 * 저작됐지만, 실제 행위 시간(`Behavior.durationSec`)은 사용자가 설정에서 바꿀 수 있다.
 * `scaleSteps` 는 그 차이를 메운다 — 단계별 시간을 목표 시간에 맞춰 비례 재배분한다.
 *
 * 원문에 시간이 **명시된** 단계(`minDurationSec`)는 그 아래로 줄지 않는다. 스트레칭
 * 유지 시간은 근거의 일부라서다(2026-08-14 결정) — 목표 시간이 그 최소 합보다 짧으면
 * 최소 합을 그대로 쓴다. 실제로 도는 시간이 설정보다 살짝 길어질 수 있다는 뜻이지만,
 * 근거 유지시간을 어기는 것보다는 낫다는 판단이다.
 */

import type { ActionStepContent } from '../constants/strings'

export interface ScaledStep {
  readonly label: string
  readonly durationSec: number
}

export interface CurrentStep {
  readonly index: number
  readonly step: ScaledStep
  /** 이 단계 안에서 남은 시간(ms) */
  readonly remainingMsInStep: number
  readonly totalMs: number
}

/** 원문에 시간이 없는 단계(회수만 있는 동작)의 방어적 하한 — 0초 단계 방지용일 뿐, 근거는 아니다 */
const FALLBACK_MIN_STEP_SEC = 3

function floorOf(step: ActionStepContent): number {
  return Math.max(1, step.minDurationSec ?? FALLBACK_MIN_STEP_SEC)
}

/**
 * 원고 단계 배열을 목표 시간(초)에 맞춰 정수 초로 재배분한다.
 *
 * water-filling: floor 에 걸리는 단계부터 고정하고, 남은 단계끼리 원래 비중대로 다시 나눈다.
 * 반올림은 largest-remainder — 정수 합이 목표(또는 floor 합)와 정확히 일치하고, 0초 단계가
 * 생기지 않는다.
 */
export function scaleSteps(
  steps: readonly ActionStepContent[],
  targetDurationSec: number
): ScaledStep[] {
  if (steps.length === 0) return []

  const floors = steps.map(floorOf)
  const floorSum = floors.reduce((a, b) => a + b, 0)
  const target = Math.max(Math.round(targetDurationSec), floorSum)

  // ① water-filling — 비례 배분이 floor 아래로 내려가는 단계를 floor 에 고정하고 반복
  const fixed: (number | null)[] = steps.map(() => null)
  for (;;) {
    const freeIdx = steps.map((_, i) => i).filter((i) => fixed[i] === null)
    if (freeIdx.length === 0) break

    const usedByFixed = fixed.reduce((sum: number, v) => sum + (v ?? 0), 0)
    const remaining = target - usedByFixed
    const freeWeight = freeIdx.reduce((sum, i) => sum + steps[i].durationSec, 0)

    let fixedThisRound = false
    for (const i of freeIdx) {
      const share = freeWeight > 0 ? (remaining * steps[i].durationSec) / freeWeight : remaining / freeIdx.length
      if (share < floors[i]) {
        fixed[i] = floors[i]
        fixedThisRound = true
      }
    }
    if (!fixedThisRound) {
      for (const i of freeIdx) {
        fixed[i] =
          freeWeight > 0 ? (remaining * steps[i].durationSec) / freeWeight : remaining / freeIdx.length
      }
      break
    }
  }

  // ② 정수 반올림 — 나머지는 소수부가 큰 단계부터 +1 (합이 target 과 정확히 같아진다)
  const raw = fixed.map((v) => v ?? 0)
  const floored = raw.map((v) => Math.floor(v))
  let deficit = target - floored.reduce((a, b) => a + b, 0)
  const byFrac = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  const result = [...floored]
  for (let k = 0; k < byFrac.length && deficit > 0; k++) {
    result[byFrac[k].i] += 1
    deficit--
  }

  return steps.map((s, i) => ({ label: s.label, durationSec: result[i] }))
}

export function stepsTotalMs(steps: readonly ScaledStep[]): number {
  return steps.reduce((sum, s) => sum + s.durationSec, 0) * 1000
}

/**
 * elapsedMs 시점에 보여줄 단계. 전부 끝났으면(elapsed >= 합계) null.
 * `remainingMsInStep` 은 항상 1 이상 — 0 을 반환하면 화면이 "0초"를 한 프레임 그린다.
 */
export function currentStepAt(steps: readonly ScaledStep[], elapsedMs: number): CurrentStep | null {
  if (steps.length === 0) return null
  const totalMs = stepsTotalMs(steps)
  const clamped = Math.max(0, elapsedMs)
  if (clamped >= totalMs) return null

  let acc = 0
  for (let i = 0; i < steps.length; i++) {
    const stepMs = steps[i].durationSec * 1000
    if (clamped < acc + stepMs) {
      return { index: i, step: steps[i], remainingMsInStep: acc + stepMs - clamped, totalMs }
    }
    acc += stepMs
  }
  // 반올림 오차로 못 들어가도 마지막 단계는 보여준다 (안전망)
  const last = steps.length - 1
  return { index: last, step: steps[last], remainingMsInStep: 1, totalMs }
}
