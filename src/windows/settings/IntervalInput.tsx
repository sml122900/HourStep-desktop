import { useEffect, useRef, useState } from 'react'
import {
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  clampIntervalMinutes,
} from '../../core/behaviors'

/**
 * 간격(분) 입력칸.
 *
 * **입력 중에는 문자열로 들고, 포커스가 빠질 때 정규화한다.** 숫자로 바로 받으면 마지막
 * 한 글자를 지우는 순간 `Number('')` 가 0 이 되어, 화면은 `0`으로 튀고 저장 시 정규화가
 * 범위 밖 값으로 판단해 시드 간격으로 되돌려 버린다. 지우는 중일 뿐인데 값이 바뀐다.
 *
 * 그래서 빈 문자열을 **허용**하고, 범위 안의 값일 때만 위로 커밋한다. 비운 채 포커스를
 * 옮기면 `onCommit` 이 경계값으로 복구한다.
 */
export default function IntervalInput({
  value,
  disabled,
  onChange,
  onCommit,
}: {
  value: number
  disabled?: boolean
  /** 입력 도중 유효한 값이 됐을 때. 화면 상태만 갱신하는 용도 */
  onChange: (minutes: number) => void
  /** 포커스가 빠질 때. 복구된 최종값을 준다 — 저장은 여기서 */
  onCommit: (minutes: number) => void
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
      min={MIN_INTERVAL_MINUTES}
      max={MAX_INTERVAL_MINUTES}
      value={draft}
      disabled={disabled}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        // 숫자만, 선행 0 제거, 빈 문자열 허용(지우는 중)
        const next = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
        setDraft(next)

        const n = Number(next)
        // 유효할 때만 위로 올린다. 범위 밖·빈칸은 blur 에서 복구한다
        if (next !== '' && n >= MIN_INTERVAL_MINUTES && n <= MAX_INTERVAL_MINUTES) onChange(n)
      }}
      onBlur={() => {
        focused.current = false
        const fixed = clampIntervalMinutes(draft)
        setDraft(String(fixed))
        onCommit(fixed)
      }}
    />
  )
}
