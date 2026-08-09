import { useEffect, useRef, useState } from 'react'

/**
 * 정수 입력칸 (간격·행위 시간이 같이 쓴다).
 *
 * **입력 중에는 문자열로 들고, 포커스가 빠질 때 정규화한다.** 숫자로 바로 받으면 마지막
 * 한 글자를 지우는 순간 `Number('')` 가 0 이 되어, 화면은 `0`으로 튀고 저장 시 정규화가
 * 범위 밖 값으로 판단해 시드 값으로 되돌려 버린다. 지우는 중일 뿐인데 값이 바뀐다.
 *
 * 그래서 빈 문자열을 **허용**하고, 범위 안의 값일 때만 위로 커밋한다. 비운 채 포커스를
 * 옮기면 `clamp` 가 경계값으로 복구한다. (D2.6 후속에서 간격칸에 생긴 규칙을 D2.7 에서
 * 행위 시간칸이 그대로 물려받았다 — 두 칸이 다르게 굴면 그게 더 놀랍다.)
 */
export default function NumberInput({
  value,
  min,
  max,
  clamp,
  disabled,
  ariaLabel,
  onChange,
  onCommit,
}: {
  value: number
  min: number
  max: number
  /** 빈칸·범위 밖 입력을 최종값으로 되돌리는 순수 함수 (`src/core/behaviors.ts`) */
  clamp: (raw: string) => number
  disabled?: boolean
  ariaLabel?: string
  /** 입력 도중 유효한 값이 됐을 때. 화면 상태만 갱신하는 용도 */
  onChange: (value: number) => void
  /** 포커스가 빠질 때. 복구된 최종값을 준다 — 저장은 여기서 */
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(() => String(value))
  const focused = useRef(false)

  /**
   * 밖에서 값이 바뀌면 따라간다 (「기본값 복원」, 다른 창의 변경, `--debug-cmd`).
   * 단 **입력 중일 때는 건드리지 않는다** — 타이핑하던 값이 덮이면 안 된다.
   */
  useEffect(() => {
    if (!focused.current) setDraft(String(value))
  }, [value])

  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        // 숫자만, 선행 0 제거, 빈 문자열 허용(지우는 중)
        const next = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
        setDraft(next)

        const n = Number(next)
        // 유효할 때만 위로 올린다. 범위 밖·빈칸은 blur 에서 복구한다
        if (next !== '' && n >= min && n <= max) onChange(n)
      }}
      onBlur={() => {
        focused.current = false
        const fixed = clamp(draft)
        setDraft(String(fixed))
        onCommit(fixed)
      }}
    />
  )
}
