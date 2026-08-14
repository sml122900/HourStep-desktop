import { describe, expect, it } from 'vitest'
import type { ActionStepContent } from '../constants/strings'
import { currentStepAt, scaleSteps, stepsTotalMs } from './actionSteps'

describe('scaleSteps — 목표 시간과 원본 합이 같을 때', () => {
  it('원문 값을 그대로 돌려준다(반올림 오차 없음)', () => {
    const steps: ActionStepContent[] = [
      { label: '왼쪽', durationSec: 30, minDurationSec: 15 },
      { label: '오른쪽', durationSec: 30, minDurationSec: 15 },
    ]
    expect(scaleSteps(steps, 60)).toEqual([
      { label: '왼쪽', durationSec: 30 },
      { label: '오른쪽', durationSec: 30 },
    ])
  })
})

describe('scaleSteps — 목표가 원본보다 길 때(스케일 업)', () => {
  it('비중대로 늘어나고 합이 목표와 같다', () => {
    const steps: ActionStepContent[] = [
      { label: '왼쪽', durationSec: 30, minDurationSec: 15 },
      { label: '오른쪽', durationSec: 30, minDurationSec: 15 },
    ]
    const scaled = scaleSteps(steps, 90)
    expect(scaled).toEqual([
      { label: '왼쪽', durationSec: 45 },
      { label: '오른쪽', durationSec: 45 },
    ])
  })
})

describe('scaleSteps — 목표가 floor 합보다 짧을 때', () => {
  it('B1: 좌우 각 15초 아래로는 안 줄어든다 (설정 20초 요청해도 결과는 30초)', () => {
    const steps: ActionStepContent[] = [
      { label: '왼쪽', durationSec: 30, minDurationSec: 15 },
      { label: '오른쪽', durationSec: 30, minDurationSec: 15 },
    ]
    const scaled = scaleSteps(steps, 20)
    expect(scaled).toEqual([
      { label: '왼쪽', durationSec: 15 },
      { label: '오른쪽', durationSec: 15 },
    ])
    expect(stepsTotalMs(scaled)).toBe(30_000) // 요청한 20초보다 길다 — floor 우선
  })

  it('C1: 4단계 모두 이미 floor 라서 목표를 아무리 줄여도 60초를 유지한다', () => {
    const steps: ActionStepContent[] = Array.from({ length: 4 }, (_, i) => ({
      label: `step${i}`,
      durationSec: 15,
      minDurationSec: 15,
    }))
    const scaled = scaleSteps(steps, 8)
    expect(scaled.every((s) => s.durationSec === 15)).toBe(true)
    expect(stepsTotalMs(scaled)).toBe(60_000)
  })

  it('A1: 단일 단계(60초 고정)도 floor 아래로 줄지 않는다', () => {
    const steps: ActionStepContent[] = [{ label: '반복', durationSec: 60, minDurationSec: 60 }]
    expect(scaleSteps(steps, 20)).toEqual([{ label: '반복', durationSec: 60 }])
  })
})

describe('scaleSteps — floor 가 섞인 다단계 축소', () => {
  it('floor 에 걸리는 단계는 고정하고 나머지끼리 다시 나눈다', () => {
    const steps: ActionStepContent[] = [
      { label: 'a', durationSec: 10, minDurationSec: 5 },
      { label: 'b', durationSec: 10 }, // fallback floor 3
      { label: 'c', durationSec: 40 }, // fallback floor 3
    ]
    const scaled = scaleSteps(steps, 15)
    const sum = scaled.reduce((s, v) => s + v.durationSec, 0)
    expect(sum).toBe(15)
    expect(scaled.every((s) => s.durationSec >= 1)).toBe(true)
    expect(scaled[0].durationSec).toBeGreaterThanOrEqual(5)
  })
})

describe('scaleSteps — 반올림', () => {
  it('정수 초 합이 항상 목표와 정확히 같다 (0초 단계 없음)', () => {
    const steps: ActionStepContent[] = [
      { label: 'a', durationSec: 15, minDurationSec: 15 },
      { label: 'b', durationSec: 15, minDurationSec: 15 },
      { label: 'c', durationSec: 15, minDurationSec: 15 },
      { label: 'd', durationSec: 15, minDurationSec: 15 },
    ]
    // 60 -> 61, 62, 100 처럼 4로 안 떨어지는 값들
    for (const target of [61, 62, 65, 70, 100, 101]) {
      const scaled = scaleSteps(steps, target)
      expect(scaled.reduce((s, v) => s + v.durationSec, 0)).toBe(target)
      expect(scaled.every((s) => s.durationSec > 0)).toBe(true)
    }
  })
})

describe('currentStepAt', () => {
  const scaled = [
    { label: '왼쪽', durationSec: 30 },
    { label: '오른쪽', durationSec: 30 },
  ]

  it('첫 단계 시작(elapsed=0)', () => {
    const c = currentStepAt(scaled, 0)
    expect(c?.index).toBe(0)
    expect(c?.remainingMsInStep).toBe(30_000)
    expect(c?.totalMs).toBe(60_000)
  })

  it('경계 직전(29.999초)까지는 첫 단계', () => {
    expect(currentStepAt(scaled, 29_999)?.index).toBe(0)
  })

  it('경계(30초)부터 두 번째 단계', () => {
    const c = currentStepAt(scaled, 30_000)
    expect(c?.index).toBe(1)
    expect(c?.remainingMsInStep).toBe(30_000)
  })

  it('전부 끝나면(elapsed >= 합계) null', () => {
    expect(currentStepAt(scaled, 60_000)).toBeNull()
    expect(currentStepAt(scaled, 100_000)).toBeNull()
  })

  it('음수 elapsed 도 안전하게 첫 단계로 접는다', () => {
    expect(currentStepAt(scaled, -100)?.index).toBe(0)
  })

  it('단계가 없으면 null', () => {
    expect(currentStepAt([], 0)).toBeNull()
  })
})
