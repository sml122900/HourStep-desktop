import type { ElementType, ReactNode } from 'react'

/**
 * 테두리 있는 면. 두 가지뿐이다 —
 * `panel` 은 화면을 나누는 덩어리(세션 패널·통계 패널), `row` 는 목록의 한 줄
 * (설정의 행동, AI 미리보기). 셋째 변형이 필요해지면 그건 대개 레이아웃 문제다.
 *
 * **오버레이 카드는 이걸 쓰지 않는다.** 창이 카드 실크기라 그림자·바깥 여백을 못 쓰고
 * 배경도 전용 토큰(--overlay-bg)이라, 규칙이 다르다 (docs/decisions/0005).
 */
export default function Card({
  as: Tag = 'div',
  variant = 'panel',
  className,
  children,
}: {
  /** 의미에 맞는 태그로 그린다 (section / li / div) */
  as?: ElementType
  variant?: 'panel' | 'row'
  className?: string
  children: ReactNode
}) {
  const classes = ['card']
  if (variant === 'row') classes.push('card--row')
  if (className) classes.push(className)

  return <Tag className={classes.join(' ')}>{children}</Tag>
}
