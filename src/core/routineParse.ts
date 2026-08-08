/**
 * 붙여넣은 AI 답변에서 `[HOURSTEP]` 블록을 뽑아 행동 후보로 바꾼다 — IO 없는 순수 모듈.
 *
 * D2.6 「AI 검색 브리지」의 입력단. 앱은 구글 결과를 **직접 읽지 않는다** — 사용자가 복사해
 * 가져온 텍스트만 다룬다 (근거: docs/decisions/0008). 그래서 이 파일에 오는 문자열은
 * 전적으로 신뢰 불가다: 형식이 어긋나 있고, 마크다운·코드펜스·전각 문자가 섞여 있고,
 * 아예 블록이 없을 수도 있다. **어떤 입력에도 예외를 던지지 않고** 결과를 돌려준다 —
 * 실패는 에러가 아니라 "수동 입력으로 가라"는 신호다 (스펙 4. 폴백).
 *
 * 여기서 만든 `RoutineItem` 은 아직 행동이 아니다. 사용자가 미리보기에서 확인·수정한 뒤에만
 * `routineItemsToBehaviors()` 를 거쳐 저장된다. 직삽입 경로는 만들지 않는다.
 */

import {
  MAX_BEHAVIORS,
  MAX_EMOJI_CODEPOINTS,
  MAX_INTERVAL_MINUTES,
  MAX_LABEL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MIN_INTERVAL_MINUTES,
  normalizeBehavior,
} from './behaviors'
import type { Behavior } from './types'

const MIN = 60_000

/** 질의 템플릿(`aiQuery.ts`)이 AI 에게 요구하는 블록 표식. 대소문자는 가리지 않는다. */
export const BLOCK_OPEN = '[HOURSTEP]'
export const BLOCK_CLOSE = '[/HOURSTEP]'

/** 이모지 칸이 비었거나 이모지가 아니면 이걸 쓴다 */
export const ROUTINE_FALLBACK_EMOJI = '🔔'

/**
 * 파싱 단계의 이름·문구 상한. 앱이 실제로 저장하는 상한(`MAX_LABEL_LENGTH` 24 /
 * `MAX_MESSAGE_LENGTH` 80)보다 **느슨하다**.
 *
 * 둘을 나눈 이유: 여기서의 상한은 "이 줄이 행동 이름이 맞는가"를 판별하는 기준이고
 * (문단 하나가 통째로 들어오면 그건 행동이 아니다), 저장 상한은 "카드에 들어가는가"다.
 * 그래서 조금 긴 건 **잘라서 살리고**, 터무니없이 긴 건 버린다. 잘린 값은 미리보기에
 * 그대로 보이므로 사용자가 보고 고칠 수 있다 — 저장된 것과 화면이 갈라지지 않는다.
 */
export const MAX_PARSED_LABEL_LENGTH = 30
export const MAX_PARSED_MESSAGE_LENGTH = 120

/**
 * 실패 사유 — 문장이 아니라 **코드**로 돌려준다. 한국어 카피는 UI 상수
 * (`src/constants/strings.ts`)가 소유하고, 코어는 판정만 한다. 테스트도 코드로 검증한다.
 *
 * - `ok`          전부 읽었다
 * - `partial`     읽었지만 형식이 어긋난 줄을 건너뛰었다 (`skipped` 에 개수)
 * - `no-block`    `[HOURSTEP]…[/HOURSTEP]` 이 없다
 * - `empty-block` 블록은 있는데 쓸 만한 줄이 하나도 없다
 */
export type RoutineParseReason = 'ok' | 'partial' | 'no-block' | 'empty-block'

export interface RoutineItem {
  emoji: string
  label: string
  minutes: number
  message: string
}

export interface RoutineParseResult {
  ok: boolean
  items: RoutineItem[]
  reason: RoutineParseReason
  /** 형식이 어긋나 건너뛴 줄 수 */
  skipped: number
}

/** 전각 파이프(｜)·박스 드로잉(│) 등 "파이프처럼 생긴 것"을 전부 구분자로 본다 */
const PIPE = /[|｜│┃∣❘]/

/** 템플릿을 그대로 따라 쓴 줄. 건너뛰되 "형식 오류"로 세지 않는다 (사용자 잘못이 아니다) */
const TEMPLATE_LABEL = '행동이름'

/** 코드포인트 단위로 자른다 — `String.slice` 는 서로게이트 페어를 갈라 이모지를 깨뜨린다 */
function clip(value: string, max: number): string {
  const points = [...value]
  return points.length <= max ? value : points.slice(0, max).join('')
}

/**
 * 한 줄에서 장식을 걷어낸다. AI 답변은 거의 항상 마크다운을 입고 온다 —
 * 코드펜스로 감싸이고, 볼드가 섞이고, 표(`| a | b |`)나 불릿으로 나온다.
 */
function strip(line: string): string {
  return line
    .replace(/```+/g, ' ') // 코드펜스
    .replace(/\*\*|__|`/g, '') // 볼드·인라인 코드
    .replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '') // 불릿·번호 목록
    .trim()
}

/** 대소문자 무시하고 열림/닫힘 쌍을 전부 찾는다. 짝이 없는 열림은 버린다. */
function extractBlocks(text: string): string[] {
  const haystack = text.toLowerCase()
  const open = BLOCK_OPEN.toLowerCase()
  const close = BLOCK_CLOSE.toLowerCase()
  const blocks: string[] = []

  let from = 0
  for (;;) {
    const start = haystack.indexOf(open, from)
    if (start < 0) break
    const end = haystack.indexOf(close, start + open.length)
    if (end < 0) break
    blocks.push(text.slice(start + open.length, end))
    from = end + close.length
  }
  return blocks
}

/** `"30분"`, `"25~30분마다"`, `"| 30 |"` 에서 분을 뽑는다. 범위 밖이면 null → 항목 reject */
function parseMinutes(field: string): number | null {
  // 부호까지 잡아야 "-5" 가 5 로 둔갑하지 않는다
  const digits = field.match(/-?\d+/)
  if (!digits) return null
  const n = Number(digits[0])
  if (!Number.isInteger(n) || n < MIN_INTERVAL_MINUTES || n > MAX_INTERVAL_MINUTES) return null
  return n
}

/** 이모지 칸 검증. 없거나 글자가 섞여 있으면 기본값으로 대체한다 (항목을 버리지는 않는다) */
function pickEmoji(field: string): string {
  const value = field.trim()
  if (!value) return ROUTINE_FALLBACK_EMOJI
  // 한글·라틴 문자·숫자가 들어 있으면 이모지 칸이 아니라 다른 걸 잘못 넣은 것이다
  if (/[\p{Letter}\p{Number}]/u.test(value)) return ROUTINE_FALLBACK_EMOJI
  if ([...value].length > MAX_EMOJI_CODEPOINTS) return ROUTINE_FALLBACK_EMOJI
  return value
}

/** 한 줄 → 항목. 형식이 어긋나면 null (그 줄만 버리고 전체는 실패시키지 않는다) */
function parseLine(raw: string): RoutineItem | null | 'template' {
  const line = strip(raw)
  if (!line) return null

  const fields = line.split(PIPE).map((f) => f.trim())
  // 표 형식(`| a | b | c | d |`)이면 양끝에 빈 칸이 생긴다. 그것만 걷어낸다.
  // 이미 4칸이면 손대지 않는다 — 이모지 칸이 비어 있는 정상적인 줄을 표로 오인하면 안 된다.
  while (fields.length > 4 && fields[0] === '') fields.shift()
  while (fields.length > 4 && fields[fields.length - 1] === '') fields.pop()
  if (fields.length !== 4) return null

  const [emoji, label, minutes, message] = fields
  if (label === TEMPLATE_LABEL) return 'template'

  const minutesValue = parseMinutes(minutes)
  if (minutesValue === null) return null
  if (!label || [...label].length > MAX_PARSED_LABEL_LENGTH) return null
  if (!message || [...message].length > MAX_PARSED_MESSAGE_LENGTH) return null

  return {
    emoji: pickEmoji(emoji),
    label: clip(label, MAX_LABEL_LENGTH),
    minutes: minutesValue,
    message: clip(message, MAX_MESSAGE_LENGTH),
  }
}

/**
 * 붙여넣은 텍스트에서 루틴 항목을 뽑는다.
 *
 * 블록이 여러 개면 **항목이 나오는 마지막 블록**을 쓴다. 질의가 "답변 마지막에 정리해줘"라고
 * 요구하므로 뒤쪽이 진짜 답이고, 앞쪽은 AI 가 형식 설명을 하며 따라 쓴 빈 템플릿일 때가 많다.
 */
export function parseRoutineBlock(text: string): RoutineParseResult {
  const blocks = extractBlocks(typeof text === 'string' ? text : '')
  if (blocks.length === 0) return { ok: false, items: [], reason: 'no-block', skipped: 0 }

  for (let i = blocks.length - 1; i >= 0; i--) {
    const items: RoutineItem[] = []
    let skipped = 0

    for (const line of blocks[i].split('\n')) {
      const parsed = parseLine(line)
      if (parsed === 'template') continue
      if (parsed === null) {
        if (strip(line)) skipped++ // 빈 줄은 오류가 아니다
        continue
      }
      if (items.length >= MAX_BEHAVIORS) break
      items.push(parsed)
    }

    if (items.length > 0) {
      return { ok: true, items, reason: skipped > 0 ? 'partial' : 'ok', skipped }
    }
  }

  return { ok: false, items: [], reason: 'empty-block', skipped: 0 }
}

/**
 * 확인된 항목을 **기존 목록 뒤에 붙인** 새 목록으로 만든다. 저장은 호출부가
 * `saveBehaviorsAndBroadcast()` 로 한다 — 거기서 정규화·상한(MAX_BEHAVIORS)이 다시 걸린다.
 *
 * `now` 를 인자로 받는 이유는 코어에서 `Date.now()` 를 부르지 않기 위해서다 (CLAUDE.md 규칙 4).
 */
export function routineItemsToBehaviors(
  existing: Behavior[],
  items: RoutineItem[],
  now: number
): Behavior[] {
  const taken = new Set(existing.map((b) => b.id))

  const added = items.map((item, index) => {
    let id = `ai-${now}-${index + 1}`
    for (let n = 2; taken.has(id); n++) id = `ai-${now}-${index + 1}-${n}`
    taken.add(id)

    return normalizeBehavior({
      id,
      label: item.label,
      emoji: item.emoji,
      message: item.message,
      rule: { kind: 'interval', everyMs: item.minutes * MIN },
      enabled: true,
      isBuiltin: false,
      // 우리가 지어낸 문구가 아니라 사용자가 가져온 문구다. 설정 목록에 출처로 표시한다.
      source: 'ai',
      sortOrder: existing.length + index,
    })
  })

  return [...existing, ...added]
}
