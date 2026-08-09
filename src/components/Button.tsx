import type { ButtonHTMLAttributes } from 'react'

/**
 * 전 창 공통 버튼. **다른 버튼 스타일을 새로 만들지 않는다** — D2.8 이전에는 같은 성격의
 * 버튼이 창마다 `.ghost` / `.chip` / `.btn` / `.session__toggle` 로 갈라져 있었고,
 * 그래서 라이트 모드를 붙일 때 네 군데를 따로 손봐야 했다.
 *
 * - `primary`   되돌릴 수 없거나 그 화면의 주된 행동 (작업 시작, [완료], 삽입)
 * - `secondary` 나란히 서는 보통 행동 (설정 열기, 복사, 미리듣기)
 * - `ghost`     테두리 없이 물러나 있는 행동 (건너뛰기, 나중에)
 * - `danger`    지우는 행동. 평소엔 조용하고 hover 에서만 붉어진다
 *
 * 크기는 sm(28px) / md(34px) 두 단. `icon` 은 글자 하나짜리(↑ ↓ ✕) 정사각형.
 */
export default function Button({
  variant = 'secondary',
  size = 'md',
  icon = false,
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  icon?: boolean
}) {
  const classes = ['btn', `btn--${variant}`, `btn--${size}`]
  if (icon) classes.push('btn--icon')
  if (className) classes.push(className)

  return <button type={type} className={classes.join(' ')} {...rest} />
}
