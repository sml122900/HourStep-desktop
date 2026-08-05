import { describe, expect, it } from 'vitest'
import { computeOverlayWindowPosition } from './overlayPosition'

const FHD = { x: 0, y: 0, width: 1920, height: 1080 }

describe('computeOverlayWindowPosition', () => {
  it('주 모니터 가로 중앙, 상단에 붙인다', () => {
    expect(computeOverlayWindowPosition(FHD, { width: 560, height: 240 })).toEqual({
      x: 680,
      y: 0,
    })
  })

  it('모니터 원점이 음수인 보조 모니터(주 모니터 왼쪽)에서도 중앙 정렬된다', () => {
    const left = { x: -2560, y: -120, width: 2560, height: 1440 }
    expect(computeOverlayWindowPosition(left, { width: 560, height: 240 })).toEqual({
      x: -2560 + 1000,
      y: -120,
    })
  })

  it('홀수 여백은 반올림해 정수 좌표를 반환한다', () => {
    const odd = { x: 0, y: 0, width: 1365, height: 768 }
    const pos = computeOverlayWindowPosition(odd, { width: 560, height: 240 })
    expect(Number.isInteger(pos.x)).toBe(true)
    expect(pos.x).toBe(403) // round((1365 - 560) / 2) = round(402.5) = 403
  })

  it('오버레이가 모니터보다 넓으면 모니터 왼쪽 끝으로 클램프한다', () => {
    const narrow = { x: 100, y: 50, width: 400, height: 300 }
    expect(computeOverlayWindowPosition(narrow, { width: 560, height: 240 })).toEqual({
      x: 100,
      y: 50,
    })
  })

  it('고DPI(물리 픽셀이 큰) 모니터에서도 중앙 계산은 동일하게 동작한다', () => {
    // 2880x1800 물리 픽셀 (150% 스케일) — 호출부가 물리 픽셀로 변환해 넘긴다
    const hidpi = { x: 0, y: 0, width: 2880, height: 1800 }
    expect(computeOverlayWindowPosition(hidpi, { width: 840, height: 360 })).toEqual({
      x: 1020,
      y: 0,
    })
  })
})
