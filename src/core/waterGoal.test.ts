import { describe, expect, it } from 'vitest'
import { MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES } from './behaviors'
import {
  AGE_GROUPS,
  DEFAULT_SESSION_HOURS,
  SEXES,
  suggestWaterInterval,
  waterReference,
} from './waterGoal'

describe('waterReference — 성별×연령 6조합 + null', () => {
  it('확정치가 있는 두 조합은 mL 을 병기한다 (아카이브 §2-2-1)', () => {
    expect(waterReference('male', '19-29')).toEqual({
      label: '하루 5~6잔(200mL 기준) · 약 1,200mL',
      liquidMl: 1200,
    })
    expect(waterReference('female', '50-64')).toEqual({
      label: '하루 5~6잔(200mL 기준) · 약 1,000mL',
      liquidMl: 1000,
    })
  })

  it('확정치가 없는 나머지 4조합은 mL 없이 단순화 문구만 준다', () => {
    for (const [sex, age] of [
      ['male', '30-49'],
      ['male', '50-64'],
      ['female', '19-29'],
      ['female', '30-49'],
    ] as const) {
      expect(waterReference(sex, age)).toEqual({ label: '하루 5~6잔(200mL 기준)', liquidMl: null })
    }
  })

  it('65+ 는 성별 무관 원문 미확인 — mL 없이 단순화 문구', () => {
    expect(waterReference('male', '65+')).toEqual({
      label: '하루 5~6잔(200mL 기준)',
      liquidMl: null,
    })
    expect(waterReference('female', '65+')).toEqual({
      label: '하루 5~6잔(200mL 기준)',
      liquidMl: null,
    })
  })

  it('성별·연령대 중 하나라도 없으면(미입력) 일반값 경로', () => {
    expect(waterReference(null, '19-29')).toEqual({
      label: '성인 기준 하루 5~6잔',
      liquidMl: null,
    })
    expect(waterReference('male', null)).toEqual({ label: '성인 기준 하루 5~6잔', liquidMl: null })
    expect(waterReference(null, null)).toEqual({ label: '성인 기준 하루 5~6잔', liquidMl: null })
  })

  it('모든 조합의 라벨에 "목표" 라는 단어가 없다 (표기 규칙: 목표 아니라 참고 기준)', () => {
    for (const sex of [...SEXES, null]) {
      for (const age of [...AGE_GROUPS, null]) {
        expect(waterReference(sex, age).label).not.toContain('목표')
      }
    }
  })
})

describe('suggestWaterInterval — 경계', () => {
  it('아카이브 예시와 같은 값을 낸다: 1.2L / 8h ≈ 80분', () => {
    expect(suggestWaterInterval(1200, 8)).toBe(80)
  })

  it('여 50-64 확정치: 1.0L / 8h', () => {
    expect(suggestWaterInterval(1000, 8)).toBe(96)
  })

  it('liquidMl 이 확정치가 아니면(0·음수·NaN) 일반값(5.5잔)으로 계산한다', () => {
    const general = suggestWaterInterval(0, DEFAULT_SESSION_HOURS)
    expect(suggestWaterInterval(-1, DEFAULT_SESSION_HOURS)).toBe(general)
    expect(suggestWaterInterval(Number.NaN, DEFAULT_SESSION_HOURS)).toBe(general)
    expect(general).toBeGreaterThan(0)
  })

  it('sessionHours 가 비정상이면 기본 세션 길이(8h)로 계산한다', () => {
    expect(suggestWaterInterval(1200, 0)).toBe(suggestWaterInterval(1200, DEFAULT_SESSION_HOURS))
    expect(suggestWaterInterval(1200, -3)).toBe(suggestWaterInterval(1200, DEFAULT_SESSION_HOURS))
    expect(suggestWaterInterval(1200, Number.NaN)).toBe(
      suggestWaterInterval(1200, DEFAULT_SESSION_HOURS)
    )
  })

  it('결과는 행동 간격 허용 범위 안으로 접힌다', () => {
    // 아주 짧은 세션 · 큰 목표 → 아주 짧은 간격이 나올 수 있다. 최솟값 아래로는 안 내려간다.
    expect(suggestWaterInterval(50_000, 0.01)).toBeGreaterThanOrEqual(MIN_INTERVAL_MINUTES)
    // 아주 긴 세션 · 아주 작은 목표 → 최댓값을 넘지 않는다.
    expect(suggestWaterInterval(1, 1000)).toBeLessThanOrEqual(MAX_INTERVAL_MINUTES)
  })
})
