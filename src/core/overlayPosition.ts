/**
 * 오버레이 창 배치 계산 — IO 없는 순수 모듈.
 * CLAUDE.md 코딩 규칙: src/core/ 아래는 React·Tauri import 금지.
 *
 * 좌표 단위는 모두 물리 픽셀(physical px). 멀티 모니터에서 모니터 원점(x, y)은
 * 주 모니터 왼쪽 위 기준의 가상 데스크톱 좌표라 음수가 될 수 있다.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

/**
 * 오버레이 창을 대상 모니터의 "가로 중앙 / 세로 최상단"에 붙인다.
 *
 * 창 자체는 모니터 상단에 딱 붙이고(y = monitor.y), 카드가 화면 위 바깥에서
 * 미끄러져 내려오는 연출은 창 내부 CSS transform이 담당한다. 그래야 슬라이드
 * 시작 지점이 화면 밖으로 잘려 자연스럽게 보인다.
 *
 * 창이 모니터보다 크면 모니터 밖으로 나가지 않도록 클램프한다.
 */
export function computeOverlayWindowPosition(
  monitor: Rect,
  overlaySize: Size
): { x: number; y: number } {
  const centeredX = monitor.x + Math.round((monitor.width - overlaySize.width) / 2)

  const minX = monitor.x
  const maxX = monitor.x + Math.max(0, monitor.width - overlaySize.width)

  return {
    x: clamp(centeredX, minX, maxX),
    y: monitor.y,
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}
