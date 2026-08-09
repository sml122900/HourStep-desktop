import type { ReactNode } from 'react'

/**
 * on/off 체크박스. 라벨을 주면 라벨까지 클릭 영역이 되고, 안 주면 입력만 그린다
 * (설정의 행동 행처럼 옆 칸이 이미 이름을 들고 있는 경우).
 *
 * 별도의 스위치(Toggle)는 만들지 않았다 — 이 앱의 on/off 는 전부 체크박스이고,
 * 쓰이지 않는 컴포넌트는 그냥 죽은 코드다 (docs/design-system.md).
 */
export default function Checkbox({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  ariaLabel?: string
  disabled?: boolean
}) {
  const input = (
    <input
      type="checkbox"
      className="check__box"
      checked={checked}
      disabled={disabled}
      aria-label={label === undefined ? ariaLabel : undefined}
      onChange={(e) => onChange(e.target.checked)}
    />
  )

  if (label === undefined) return input

  return (
    <label className="check">
      {input}
      <span>{label}</span>
    </label>
  )
}
