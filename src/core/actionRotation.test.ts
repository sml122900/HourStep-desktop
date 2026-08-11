import { describe, expect, it } from 'vitest'
import { ACTION_ROTATION, ROTATION_ORDER, actionAt, actionById, nextActionIndex } from './actionRotation'

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
