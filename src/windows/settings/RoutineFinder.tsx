import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { openUrl } from '@tauri-apps/plugin-opener'
import { AI_TARGETS, buildAiUrl, buildRoutinePrompt, type AiTarget } from '../../core/aiQuery'
import { MAX_EMOJI_CODEPOINTS, MAX_LABEL_LENGTH, MAX_MESSAGE_LENGTH } from '../../core/behaviors'
import {
  ROUTINE_FALLBACK_EMOJI,
  parseRoutineBlock,
  type RoutineItem,
  type RoutineParseResult,
} from '../../core/routineParse'
import { AI } from '../../constants/strings'
import IntervalInput from './IntervalInput'

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

/** 토스트가 떠 있는 시간 */
const TOAST_MS = 2000

/**
 * 「AI로 루틴 찾기」 — 프롬프트 생성 → AI 로 이동 → 붙여넣기 → 미리보기 → 삽입.
 *
 * 앱은 AI 결과를 직접 읽지 않는다. 브라우저는 기본 브라우저로 열고(앱 내 웹뷰 금지),
 * 돌아오는 경로는 오직 사용자의 복사·붙여넣기다 (docs/decisions/0008).
 *
 * **프롬프트를 URL 에 몰래 태우고 끝내지 않는다.** 전문을 화면에 그대로 보여주고,
 * 어디로 가든 이동 시 클립보드에 넣는다 — 프롬프트를 못 들고 가면 이동이 무의미하기 때문이고,
 * 구글 말고 다른 AI 를 써도 되게 하려면 URL 주입에 기댈 수 없기 때문이다.
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
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef(0)
  const sectionRef = useRef<HTMLElement>(null)

  /** 화면에 그대로 보이는 프롬프트이자 클립보드에 들어가는 것. 입력이 바뀌면 즉시 따라온다. */
  const prompt = useMemo(() => buildRoutinePrompt({ job, symptom }), [job, symptom])
  const promptRef = useRef(prompt)
  promptRef.current = prompt

  function flash(message: string) {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  /**
   * `--debug-cmd settings-open:ai` — 접힌 패널을 펼치고 화면 안으로 굴린다. 이 섹션은
   * 클릭해야 열리고 목록 아래에 있는데, 사용자 데스크톱에 합성 입력(클릭·스크롤)을 주입하는 건
   * 금지라(CLAUDE.md 「검증 정책」) 펼친 상태를 캡처하려면 훅이 필요하다.
   */
  useEffect(() => {
    const unlisteners = [
      listen('settings://debug-open-ai', () => {
        setOpen(true)
        // 열리면서 늘어난 높이가 반영된 뒤에 굴려야 실제로 보이는 위치에 선다
        requestAnimationFrame(() =>
          requestAnimationFrame(() => sectionRef.current?.scrollIntoView({ block: 'start' }))
        )
      }),
      /**
       * `--debug-cmd ai-copy` — [복사] 버튼과 **같은 경로**로 클립보드에 쓴다.
       * 권한(capabilities) 배선 실수는 빌드로 안 잡히고 런타임에 조용히 실패하는 종류라
       * 여기까지는 자동으로 확인한다. 실제로 들어갔는지는 밖에서 `Get-Clipboard` 로 대조.
       */
      listen('settings://debug-copy-prompt', () => {
        void writeText(promptRef.current)
          .then(() => invoke('log_debug', { line: `ai-copy ok len=${promptRef.current.length}` }))
          .catch((e) => invoke('log_debug', { line: `ai-copy 실패: ${e}` }))
      }),
    ]
    return () => unlisteners.forEach((p) => void p.then((fn) => fn()))
  }, [])

  function reset() {
    setRows(null)
    setNotice(null)
    setError(null)
    setPasted('')
  }

  /** 실패하면 토스트 대신 안내를 남긴다 — 프롬프트 전문이 화면에 있으니 직접 복사할 수 있다 */
  async function copyPrompt(): Promise<boolean> {
    setError(null)
    try {
      await writeText(prompt)
      flash(AI.COPIED)
      return true
    } catch (e) {
      console.error('[settings] 클립보드 복사 실패', e)
      setError(AI.COPY_ERROR)
      return false
    }
  }

  /**
   * 복사 없이 이동하면 무의미하다 — **먼저 복사하고** 연다. 구글은 프롬프트가 URL 에도
   * 실리지만, 그렇다고 복사를 건너뛰지 않는다(사용자가 다시 붙여넣을 수 있어야 한다).
   * 복사가 실패해도 이동은 막지 않는다. 프롬프트 전문은 화면에 남아 있다.
   */
  async function openTarget(target: AiTarget) {
    await copyPrompt()
    try {
      await openUrl(buildAiUrl(target, prompt))
    } catch (e) {
      console.error('[settings] 브라우저 열기 실패', e)
      setError(AI.OPEN_ERROR)
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
    <section ref={sectionRef}>
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

          {/* ① 무엇을 보내는지 보고 보낸다. 접거나 숨기지 않는다. */}
          <div className="ai__field">
            <span>{AI.PROMPT_LABEL}</span>
            <pre className="ai__prompt">{prompt}</pre>
          </div>

          <div className="row">
            <button className="chip" onClick={() => void copyPrompt()}>
              {AI.PROMPT_COPY}
            </button>
            <button className="chip" onClick={() => setOpen(false)}>
              {AI.CLOSE}
            </button>
          </div>

          {/* ② 어디로 갈지는 사용자가 고른다. 주소는 core/aiQuery.ts 의 AI_TARGETS 한 곳에만. */}
          <div className="ai__field">
            <span>{AI.TARGETS_LABEL}</span>
            <div className="row row--wrap">
              {AI_TARGETS.map((target) => (
                <button key={target.id} className="chip" onClick={() => void openTarget(target)}>
                  {(target.injectsPrompt ? AI.TARGET_OPEN : AI.TARGET_OPEN_PASTE).replace(
                    '{name}',
                    target.name
                  )}
                </button>
              ))}
            </div>
          </div>
          <p className="hint">{AI.TARGETS_HINT}</p>

          {/* ③ 결과 붙여넣기 */}
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
                        {/* 미리보기 줄도 설정 목록과 같은 입력칸을 쓴다 (지우는 중 0 으로 튀지 않게) */}
                        <IntervalInput
                          value={row.minutes}
                          onChange={(minutes) => editRow(index, { minutes })}
                          onCommit={(minutes) => editRow(index, { minutes })}
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

      {/* 복사는 화면에 아무 흔적도 남기지 않는 동작이라 피드백이 없으면 눌렸는지 알 수 없다 */}
      {toast && <div className="toast">{toast}</div>}
    </section>
  )
}
