import { describe, expect, it } from 'vitest'
import {
  ACTION_ROTATION,
  ROTATION_ORDER,
  type ActionPref,
  actionAt,
  actionById,
  canDisable,
  enabledActionIds,
  nextActionIndex,
  normalizeActionPrefs,
} from './actionRotation'

describe('ACTION_ROTATION', () => {
  it('8개 동작을 배치 제안 순서 그대로 담는다', () => {
    expect(ROTATION_ORDER).toEqual(['A1', 'B1', 'B2', 'C1', 'A2', 'B3', 'B4', 'C2'])
    expect(ACTION_ROTATION).toHaveLength(8)
    expect(ACTION_ROTATION.map((a) => a.id)).toEqual(ROTATION_ORDER)
  })

  it('각 동작은 이름·방법·시간·출처를 모두 갖는다', () => {
    for (const action of ACTION_ROTATION) {
      expect(action.name.length).toBeGreaterThan(0)
      expect(action.method.length).toBeGreaterThan(0)
      expect(action.duration.length).toBeGreaterThan(0)
      expect(action.source.length).toBeGreaterThan(0)
    }
  })
})

describe('actionById', () => {
  it('id 로 찾는다 — 메인 창 상세가 id 만 받는다', () => {
    expect(actionById('B3')?.name).toBe('턱 당기기')
    expect(actionById('nope')).toBeUndefined()
  })
})

describe('actionAt / nextActionIndex', () => {
  it('전진: 매 발화 다음 동작으로 넘어간다', () => {
    expect(actionAt(0).id).toBe('A1')
    expect(actionAt(1).id).toBe('B1')
    expect(actionAt(2).id).toBe('B2')
  })

  it('순환: 마지막 다음은 처음으로 돌아간다', () => {
    expect(actionAt(7).id).toBe('C2')
    expect(nextActionIndex(7)).toBe(0)
    expect(actionAt(nextActionIndex(7)).id).toBe('A1')
  })

  it('nextActionIndex 를 계속 먹이면 8번마다 한 바퀴 돈다', () => {
    let i = 0
    const seen: string[] = []
    for (let n = 0; n < 16; n++) {
      seen.push(actionAt(i).id)
      i = nextActionIndex(i)
    }
    expect(seen).toEqual([...ROTATION_ORDER, ...ROTATION_ORDER])
  })

  it('DB 왕복: 손상되거나 범위 밖인 인덱스도 안전하게 접는다', () => {
    expect(actionAt(-1).id).toBe('C2') // 음수는 뒤에서부터
    expect(actionAt(8).id).toBe('A1') // 길이만큼은 한 바퀴 돈 것과 같다
    expect(actionAt(100).id).toBe(actionAt(100 % 8).id)
    expect(actionAt(Number.NaN).id).toBe('A1') // 손상값은 처음으로
  })
})

// ─── D2.10 — 동작 선택 ────────────────────────────────────────────────────

const allEnabled: ActionPref[] = ROTATION_ORDER.map((id) => ({ id, enabled: true }))

function withDisabled(...ids: string[]): ActionPref[] {
  const off = new Set(ids)
  return allEnabled.map((p) => ({ ...p, enabled: !off.has(p.id) }))
}

describe('enabledActionIds / canDisable', () => {
  it('켜진 것만 골라 담는다', () => {
    const prefs = withDisabled('A1', 'B2')
    expect(enabledActionIds(prefs)).toEqual(new Set(['A2', 'B1', 'B3', 'B4', 'C1', 'C2']))
  })

  it('둘 이상 켜져 있으면 아무거나 꺼도 된다', () => {
    expect(canDisable(allEnabled, 'A1')).toBe(true)
  })

  it('마지막 하나 켜진 걸 끄는 건 막는다', () => {
    const prefs = withDisabled(...ROTATION_ORDER.filter((id) => id !== 'B2'))
    expect(canDisable(prefs, 'B2')).toBe(false)
  })

  it('이미 꺼진 걸 다시 끄는 건 항상 허용(no-op)이다', () => {
    const prefs = withDisabled(...ROTATION_ORDER.filter((id) => id !== 'B2'))
    expect(canDisable(prefs, 'A1')).toBe(true) // A1 은 이미 꺼져 있다
  })
})

describe('actionAt / nextActionIndex — 켜진 것만 순회 (D2.10)', () => {
  it('꺼진 동작은 건너뛴다', () => {
    const enabled = enabledActionIds(withDisabled('B1')) // 순서: A1,B1,B2,C1,A2,B3,B4,C2
    expect(nextActionIndex(0, enabled)).toBe(2) // B1(1) 건너뛰고 B2(2)
    expect(actionAt(1, enabled).id).toBe('B2') // 지금 위치가 꺼져 있으면 다음 켜진 것으로
  })

  it('여러 개가 꺼져 있어도 순서(고정 순서 기준)는 유지한 채 건너뛴다', () => {
    const enabled = enabledActionIds(withDisabled('B2', 'A2', 'B3'))
    let i = 0
    const seen: string[] = []
    for (let n = 0; n < 5; n++) {
      seen.push(actionAt(i, enabled).id)
      i = nextActionIndex(i, enabled)
    }
    // A1 → B1 → (B2 skip) → C1 → (A2 skip) → (B3 skip) → B4 → C2 → A1 ...
    expect(seen).toEqual(['A1', 'B1', 'C1', 'B4', 'C2'])
  })

  it('딱 1개만 켜져 있으면 그 자리에 계속 머문다', () => {
    const enabled = enabledActionIds(withDisabled(...ROTATION_ORDER.filter((id) => id !== 'C1')))
    expect(actionAt(0, enabled).id).toBe('C1')
    expect(nextActionIndex(0, enabled)).toBe(ROTATION_ORDER.indexOf('C1'))
    expect(actionAt(nextActionIndex(0, enabled), enabled).id).toBe('C1')
  })

  it('enabledIds 를 안 주면 예전(D2.9)과 똑같이 8개 전부를 순회한다', () => {
    expect(actionAt(1).id).toBe('B1')
    expect(nextActionIndex(1)).toBe(2)
  })
})

describe('normalizeActionPrefs', () => {
  it('빈 목록이면 8개 전부 켬으로 채운다(최초 시드와 같은 결과)', () => {
    const prefs = normalizeActionPrefs([])
    expect(prefs.map((p) => p.id)).toEqual(ROTATION_ORDER)
    expect(prefs.every((p) => p.enabled)).toBe(true)
  })

  it('저장된 값을 그대로 반영한다', () => {
    const prefs = normalizeActionPrefs([{ id: 'A1', enabled: false }])
    expect(prefs.find((p) => p.id === 'A1')?.enabled).toBe(false)
    expect(prefs.find((p) => p.id === 'B1')?.enabled).toBe(true) // 없는 항목은 기본값(켬)
  })

  it('ROTATION_ORDER 에 없는 id 는 버린다', () => {
    const prefs = normalizeActionPrefs([{ id: 'Z9', enabled: false }])
    expect(prefs.map((p) => p.id)).toEqual(ROTATION_ORDER)
  })

  it('전부 꺼진 손상 상태는 첫 항목을 강제로 켠다 — 최소 1개 원칙', () => {
    const allOff = ROTATION_ORDER.map((id) => ({ id, enabled: false }))
    const prefs = normalizeActionPrefs(allOff)
    expect(prefs.filter((p) => p.enabled)).toHaveLength(1)
    expect(prefs[0].enabled).toBe(true)
  })
})
