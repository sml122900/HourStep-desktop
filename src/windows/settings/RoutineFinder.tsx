import { useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { buildRoutineSearchUrl } from '../../core/aiQuery'
import {
  MAX_EMOJI_CODEPOINTS,
  MAX_INTERVAL_MINUTES,
  MAX_LABEL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MIN_INTERVAL_MINUTES,
} from '../../core/behaviors'
import {
  ROUTINE_FALLBACK_EMOJI,
  parseRoutineBlock,
  type RoutineItem,
  type RoutineParseResult,
} from '../../core/routineParse'
import { AI } from '../../constants/strings'

/** 이모지 입력 상한. maxLength 는 UTF-16 단위라 코드포인트의 2배로 잡는다 (설정 창과 동일) */
const EMOJI_MAXLENGTH = MAX_EMOJI_CODEPOINTS * 2

/** 수동 입력 줄의 기본 간격 */
const MANUAL_MINUTES = 30

interface Row extends RoutineItem {
  checked: boolean
}

const blankRow = (): Row => ({
  emoji: ROUTINE_FALLBACK_EMOJI,
  label: '',
  minutes: MANUAL_MINUTES,
  message: '',
  checked: true,
})

/** 파싱 결과 → 사용자에게 보일 한 줄. 실패도 에러가 아니라 "직접 입력하라"는 안내다. */
function noticeFor(result: RoutineParseResult): string {
  switch (result.reason) {
    case 'ok':
      return AI.RESULT_OK.replace('{n}', String(result.items.length))
    case 'partial':
      return AI.RESULT_PARTIAL.replace('{n}', String(result.items.length)).replace(
        '{skipped}',
        String(result.skipped)
      )
    case 'no-block':
      return AI.RESULT_NO_BLOCK
    case 'empty-block':
      return AI.RESULT_EMPTY_BLOCK
  }
}

/**
 * 「AI로 루틴 찾기」 — 질의 조립 → 브라우저 열기 → 붙여넣기 → 미리보기 → 삽입.
 *
 * 앱은 구글 결과를 직접 읽지 않는다. 브라우저는 기본 브라우저로 열고(앱 내 웹뷰 금지),
 * 돌아오는 경로는 오직 사용자의 복사·붙여넣기다 (docs/decisions/0008).
 *
 * **파싱 실패로 끝내지 않는다** — 실패하면 붙여넣은 원문을 그대로 둔 채 빈 줄을 하나 띄워
 * 보고 직접 입력하게 한다. 성공이든 실패든 이후 경로(미리보기 → 확인 → 삽입)는 완전히 같다.
 * 삽입은 `onInsert` 를 통해 설정 창의 저장 경로(`saveBehaviorsAndBroadcast`)를 그대로 탄다.
 */
export default function RoutineFinder({
  remaining,
  onInsert,
}: {
  /** 앞으로 몇 개까지 더 추가할 수 있는가 (MAX_BEHAVIORS − 현재 개수) */
  remaining: number
  onInsert: (items: RoutineItem[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [job, setJob] = useState('')
  const [symptom, setSymptom] = useState('')
  const [pasted, setPasted] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setRows(null)
    setNotice(null)
    setError(null)
    setPasted('')
  }

  async function search() {
    setError(null)
    try {
      await openUrl(buildRoutineSearchUrl({ job, symptom }))
      setNotice(AI.SEARCH_OPENED)
    } catch (e) {
      console.error('[settings] 브라우저 열기 실패', e)
      setError(AI.SEARCH_ERROR)
    }
  }

  function analyze() {
    const result = parseRoutineBlock(pasted)
    // 실패해도 폼은 남는다 — 원문(textarea)을 보면서 직접 채워 넣을 수 있게 빈 줄을 하나 준다
    setRows(result.ok ? result.items.map((item) => ({ ...item, checked: true })) : [blankRow()])
    setNotice(noticeFor(result))
  }

  function editRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev?.map((row, i) => (i === index ? { ...row, ...patch } : row)) ?? prev)
  }

  // 이름이 빈 줄은 넣지 않는다 (수동 입력 줄을 그냥 두고 확인을 눌렀을 때)
  const selected = (rows ?? []).filter((row) => row.checked && row.label.trim())
  const overflow = selected.length > remaining

  return (
    <section>
      <h2>{AI.TITLE}</h2>

      {!open ? (
        <div className="row">
          <button className="chip" onClick={() => setOpen(true)}>
            {AI.OPEN}
          </button>
        </div>
      ) : (
        <>
          <p className="hint">{AI.INTRO}</p>

          <div className="ai__inputs">
            <label className="ai__field">
              <span>{AI.JOB_LABEL}</span>
              <input
                value={job}
                placeholder={AI.JOB_PLACEHOLDER}
                onChange={(e) => setJob(e.target.value)}
              />
            </label>
            <label className="ai__field">
              <span>{AI.SYMPTOM_LABEL}</span>
              <input
                value={symptom}
                placeholder={AI.SYMPTOM_PLACEHOLDER}
                onChange={(e) => setSymptom(e.target.value)}
              />
            </label>
          </div>

          <div className="row">
            <button className="chip" onClick={() => void search()}>
              {AI.SEARCH}
            </button>
            <button className="chip" onClick={() => setOpen(false)}>
              {AI.CLOSE}
            </button>
          </div>

          <label className="ai__field">
            <span>{AI.PASTE_LABEL}</span>
            <textarea
              className="ai__paste"
              rows={5}
              value={pasted}
              placeholder={AI.PASTE_PLACEHOLDER}
              onChange={(e) => setPasted(e.target.value)}
            />
          </label>

          <div className="row">
            <button className="chip" disabled={!pasted.trim()} onClick={analyze}>
              {AI.ANALYZE}
            </button>
            <button className="chip" onClick={() => setRows((prev) => prev ?? [blankRow()])}>
              {AI.MANUAL}
            </button>
          </div>

          {notice && <p className="hint">{notice}</p>}

          {rows && (
            <>
              <h2>{AI.PREVIEW_TITLE}</h2>
              <ul className="behaviors">
                {rows.map((row, index) => (
                  <li key={index} className="behavior">
                    <div className="behavior__row">
                      <input
                        type="checkbox"
                        checked={row.checked}
                        aria-label={row.label || AI.PREVIEW_TITLE}
                        onChange={(e) => editRow(index, { checked: e.target.checked })}
                      />
                      <input
                        className="behavior__emoji"
                        value={row.emoji}
                        maxLength={EMOJI_MAXLENGTH}
                        aria-label="이모지"
                        onChange={(e) => editRow(index, { emoji: e.target.value })}
                      />
                      <input
                        className="behavior__label"
                        value={row.label}
                        maxLength={MAX_LABEL_LENGTH}
                        placeholder="이름"
                        onChange={(e) => editRow(index, { label: e.target.value })}
                      />
                      <span className="behavior__interval">
                        <input
                          type="number"
                          min={MIN_INTERVAL_MINUTES}
                          max={MAX_INTERVAL_MINUTES}
                          value={row.minutes}
                          onChange={(e) => editRow(index, { minutes: Number(e.target.value) })}
                        />
                        분마다
                      </span>
                      <button
                        className="behavior__delete"
                        title={AI.CANCEL}
                        onClick={() => setRows(rows.filter((_, i) => i !== index))}
                      >
                        ✕
                      </button>
                    </div>

                    <input
                      className="behavior__message"
                      value={row.message}
                      maxLength={MAX_MESSAGE_LENGTH}
                      placeholder="알림 문구"
                      onChange={(e) => editRow(index, { message: e.target.value })}
                    />
                  </li>
                ))}
              </ul>

              <div className="row">
                <button className="chip" onClick={() => setRows([...rows, blankRow()])}>
                  {AI.ROW_ADD}
                </button>
              </div>

              {/* 규칙 6 — AI 가 준 문구를 그대로 저장한다. 효용을 단정하지 않는다는 고지는 고정. */}
              <p className="hint">{AI.DISCLAIMER}</p>
              {overflow && <p className="error">{AI.LIMIT.replace('{n}', String(remaining))}</p>}

              <div className="row">
                <button
                  className="chip chip--primary"
                  disabled={selected.length === 0 || overflow}
                  onClick={() => {
                    onInsert(selected.map(({ checked: _checked, ...item }) => item))
                    reset()
                  }}
                >
                  {selected.length === 0
                    ? AI.INSERT_NONE
                    : AI.INSERT.replace('{n}', String(selected.length))}
                </button>
                <button className="chip" onClick={reset}>
                  {AI.CANCEL}
                </button>
              </div>
            </>
          )}

          {error && <p className="error">{error}</p>}
        </>
      )}
    </section>
  )
}
