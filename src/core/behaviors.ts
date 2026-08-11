/**
 * 행동 목록의 정규화·편집 규칙 — IO 없는 순수 모듈. React·Tauri import 금지.
 *
 * D2.5 부터 행동은 사용자가 직접 만들고 지운다. 즉 **설정 창과 DB 둘 다 신뢰 경계**다
 * (설정 창은 사용자 입력이, DB 는 구버전·손상된 값이 들어온다). 저장된 걸 그대로 믿지 않고
 * 항상 `normalizeBehaviors()` 를 통과시킨 뒤 스케줄러에 넘긴다 — CLAUDE.md 「저장소」 규칙.
 *
 * 저장/로드는 `src/data/db.ts` 어댑터 담당.
 */

import { seedBehaviors } from './presets'
import type { Behavior, BehaviorSource } from './types'

const MIN = 60_000

/** 간격 허용 범위(분). 밖의 값은 fallback 으로 되돌린다 */
export const MIN_INTERVAL_MINUTES = 1
export const MAX_INTERVAL_MINUTES = 8 * 60

/** 새 행동의 기본 간격 */
export const DEFAULT_INTERVAL_MINUTES = 30

/**
 * 행위 시간(초) 허용 범위. **최소가 0 인 게 의미 있다** — 0 은 "값 없음"이 아니라
 * 「완료를 누르면 바로 끝나는 즉시 행동」이라는 뜻이다 (물마시기).
 * 상한 10분은 카드가 화면을 오래 붙잡지 않게 하는 선 — 그보다 긴 건 휴식이 아니라 일정이다.
 */
export const MIN_DURATION_SEC = 0
export const MAX_DURATION_SEC = 600

/** 행동 개수 상한. 카드가 몰려 뜨는 것도, DB 가 부푸는 것도 막는다 */
export const MAX_BEHAVIORS = 20

/** 문자열 상한 (코드포인트 기준 — 이모지가 잘려 깨지지 않게) */
export const MAX_EMOJI_CODEPOINTS = 4
export const MAX_LABEL_LENGTH = 24
export const MAX_MESSAGE_LENGTH = 80

/** 이모지를 비워두면 이걸 쓴다 */
export const FALLBACK_EMOJI = '⏰'

/** 이름을 비워두면 이걸 쓴다 */
export const FALLBACK_LABEL = '새 행동'

/** 코드포인트 단위로 자른다. `String.slice` 는 서로게이트 페어를 반으로 갈라 이모지를 깨뜨린다. */
function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  const points = [...trimmed]
  return points.length <= max ? trimmed : points.slice(0, max).join('')
}

function clampMinutes(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  const rounded = Math.round(n)
  if (rounded < MIN_INTERVAL_MINUTES || rounded > MAX_INTERVAL_MINUTES) return fallback
  return rounded
}

/**
 * 간격(분)을 허용 범위 **안으로 밀어 넣는다**. 범위 밖이면 시드로 되돌리는 `clampMinutes`
 * 와 다르다 — 이건 사용자가 입력 중인 값을 고쳐 주는 쪽이다. 480 을 넘겨 치면 480 이 되고,
 * 비었거나 0 이면 1 이 된다. 되돌리기보다 가까운 경계로 붙이는 게 입력 도중에는 덜 놀랍다.
 */
export function clampIntervalMinutes(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return MIN_INTERVAL_MINUTES
  const rounded = Math.round(n)
  if (rounded < MIN_INTERVAL_MINUTES) return MIN_INTERVAL_MINUTES
  if (rounded > MAX_INTERVAL_MINUTES) return MAX_INTERVAL_MINUTES
  return rounded
}

/**
 * 행위 시간(초)을 허용 범위 **안으로 밀어 넣는다**. `clampIntervalMinutes` 와 같은 성격 —
 * 입력 중인 값을 되돌리지 않고 가까운 경계로 붙인다. 비었거나 숫자가 아니면 0(즉시 행동).
 */
export function clampDurationSeconds(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return MIN_DURATION_SEC
  const rounded = Math.round(n)
  if (rounded < MIN_DURATION_SEC) return MIN_DURATION_SEC
  if (rounded > MAX_DURATION_SEC) return MAX_DURATION_SEC
  return rounded
}

/**
 * 숫자칸에 들어온 문자열에서 숫자만 남긴다. **값을 확정하지 않는다** —
 * 빈 문자열을 빈 문자열로 돌려주는 게 핵심이다. 지우는 중인 칸을 `Number('')=0` 으로
 * 확정해 버리면 마지막 글자를 지우는 순간 값이 0 으로 튀고, 저장 시 정규화가 범위 밖으로
 * 판단해 시드로 되돌려 버린다 (D2.6 후속에서 실제로 났던 버그).
 *
 * 선행 0 은 지운다 — `030` 을 그대로 두면 화면에 남고 저장값(30)과 눈에 보이는 값이 갈린다.
 * 최종 확정은 blur 에서 `clampIntervalMinutes` / `clampDurationSeconds` 가 한다.
 */
export function sanitizeDigits(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
}

/**
 * 정리된 숫자 문자열 중 **지금 위로 올려도 되는 값**만 골라낸다. 아니면 `null`.
 *
 * 이게 이 버그류의 방어선이다 — 빈칸(지우는 중)과 범위 밖은 **화면에만 두고** 위로
 * 올리지 않는다. 올려 버리면 저장·정규화가 돌아 `3` 을 지운 순간 `30` 이 되돌아오고,
 * 커서가 앞으로 밀려 더는 지울 수도 없다. 확정은 blur 의 `clamp*` 가 맡는다.
 *
 * 함수로 빼 둔 이유: 이 규칙이 컴포넌트 안에만 있으면 **테스트가 닿지 않는다.**
 * 실제로 같은 버그가 두 번 났다 — 간격칸(D2.6 후속), 리마인더칸(D2.8 에서 교체).
 */
export function liveNumber(digits: string, min: number, max: number): number | null {
  if (digits === '') return null
  const n = Number(digits)
  return n >= min && n <= max ? n : null
}

/** interval 행동의 간격(분). atElapsed 면 0 */
export function intervalMinutes(behavior: Behavior): number {
  return behavior.rule.kind === 'interval' ? Math.round(behavior.rule.everyMs / MIN) : 0
}

/** 카드에 실제로 띄울 문구. 사용자가 문구를 비워두면 이름으로 대신한다. */
export function cardMessage(behavior: Behavior): string {
  return behavior.message.trim() || behavior.label
}

/**
 * 저장돼 있던(혹은 방금 입력된) 한 건을 신뢰 가능한 형태로 만든다.
 *
 * @param fallback 같은 id 의 시드 값. 범위 밖 간격을 여기로 되돌린다 (없으면 기본 간격).
 */
export function normalizeBehavior(raw: Partial<Behavior>, fallback?: Behavior): Behavior {
  const id = clip(raw.id, 64)
  const label = clip(raw.label, MAX_LABEL_LENGTH) || fallback?.label || FALLBACK_LABEL
  const fallbackMinutes = fallback ? intervalMinutes(fallback) : DEFAULT_INTERVAL_MINUTES

  // atElapsed 는 UI 로 만들 수 없고 DB 에도 간격만 저장한다. 타입은 유지하되
  // 들어온 게 atElapsed 면 그대로 두고, 아니면 interval 로 정규화한다.
  const rule: Behavior['rule'] =
    raw.rule?.kind === 'atElapsed'
      ? { kind: 'atElapsed', atMs: Math.max(0, Math.round(raw.rule.atMs)) }
      : {
          kind: 'interval',
          everyMs:
            clampMinutes(
              raw.rule?.kind === 'interval' ? raw.rule.everyMs / MIN : undefined,
              fallbackMinutes
            ) * MIN,
        }

  return {
    id,
    label,
    emoji: clip(raw.emoji, MAX_EMOJI_CODEPOINTS) || fallback?.emoji || FALLBACK_EMOJI,
    message: clip(raw.message, MAX_MESSAGE_LENGTH),
    rule,
    intensity: raw.intensity === 'toast' || raw.intensity === 'fullscreen' ? raw.intensity : 'card',
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    // 모르는 값은 0(즉시 행동)이다. 시드로 되돌리지 않는다 — 사용자가 0 으로 바꿔둔 것과
    // 값이 없는 것을 구분할 방법이 없고, 멋대로 카운트다운을 붙이는 쪽이 더 놀랍다
    durationSec: clampDurationSeconds(raw.durationSec),
    isBuiltin: raw.isBuiltin === true,
    // 모르는 값은 'user'. AI 유래 표시는 붙일 때만 붙고, 아니면 붙지 않는 쪽이 안전하다
    source: (raw.source === 'ai' ? 'ai' : 'user') satisfies BehaviorSource,
    sortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : 0,
    // 범위를 여기서 접지 않는다 — `actionRotation.actionAt()` 가 어떤 정수든 안전하게 감싸
    // 읽으므로, 여기서는 "손상되지 않은 음이 아닌 정수"만 보장한다 (D2.9)
    actionIndex:
      typeof raw.actionIndex === 'number' && Number.isFinite(raw.actionIndex)
        ? Math.max(0, Math.trunc(raw.actionIndex))
        : 0,
  }
}

/**
 * 목록 전체를 정규화한다. id 가 비었거나 중복이면 버리고, 개수를 자르고,
 * sortOrder 를 0부터 연속으로 다시 매긴다 (편집 중 생기는 구멍·동점을 없앤다).
 */
export function normalizeBehaviors(raws: Partial<Behavior>[]): Behavior[] {
  const seeds = new Map(seedBehaviors().map((b) => [b.id, b]))
  const seen = new Set<string>()
  const out: Behavior[] = []

  const ordered = raws
    .map((raw, index) => ({ raw, index }))
    // 동점이면 원래 순서를 유지한다 (Array.sort 는 안정 정렬이지만 명시해 둔다)
    .sort(
      (a, b) => (Number(a.raw.sortOrder) || 0) - (Number(b.raw.sortOrder) || 0) || a.index - b.index
    )

  for (const { raw } of ordered) {
    const behavior = normalizeBehavior(raw, seeds.get(String(raw.id)))
    if (!behavior.id || seen.has(behavior.id)) continue
    if (out.length >= MAX_BEHAVIORS) break
    seen.add(behavior.id)
    out.push({ ...behavior, sortOrder: out.length })
  }

  return out
}

/**
 * 새 행동 한 건. id 는 `now` 로 만든다 — `Date.now()` 를 코어에서 부르지 않기 위해
 * 호출부가 주입한다(CLAUDE.md 규칙 4). 같은 밀리초에 두 번 눌러도 겹치지 않게 접미사를 붙인다.
 */
export function newBehavior(existing: Behavior[], now: number): Behavior {
  const taken = new Set(existing.map((b) => b.id))
  let id = `b-${now}`
  for (let n = 2; taken.has(id); n++) id = `b-${now}-${n}`

  return normalizeBehavior({
    id,
    label: FALLBACK_LABEL,
    emoji: FALLBACK_EMOJI,
    message: '',
    rule: { kind: 'interval', everyMs: DEFAULT_INTERVAL_MINUTES * MIN },
    enabled: true,
    isBuiltin: false,
    sortOrder: existing.length,
  })
}

/** 위/아래로 한 칸. 끝에서 더 움직이면 원본을 그대로 돌려준다. */
export function moveBehavior(behaviors: Behavior[], id: string, delta: -1 | 1): Behavior[] {
  const from = behaviors.findIndex((b) => b.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= behaviors.length) return behaviors

  const next = [...behaviors]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next.map((b, i) => ({ ...b, sortOrder: i }))
}

/**
 * 「기본값 복원」 — 내장 3종을 시드 값으로 되돌린다.
 *
 * 사용자가 만든 행동은 건드리지 않는다. 복원이 "전부 지우기"가 되면 실수로 눌렀을 때
 * 되돌릴 방법이 없기 때문. 지워버린 내장 행동은 다시 채워 넣고, 순서는 시드가 앞에 온다.
 */
export function restoreBuiltins(behaviors: Behavior[]): Behavior[] {
  const seeds = seedBehaviors()
  const seedIds = new Set(seeds.map((b) => b.id))
  const custom = behaviors.filter((b) => !seedIds.has(b.id))
  return normalizeBehaviors([...seeds, ...custom])
}

/** D2 까지 설정 JSON 안에 있던 행동 설정. v2 로 올라올 때 한 번 흡수하고 버린다. */
export interface LegacyBehaviorSetting {
  behaviorId: string
  enabled: boolean
  everyMinutes: number
}

/**
 * v1(설정 JSON) → v2(behaviors 테이블) 로 올라올 때 기존 on/off·간격을 시드에 덧씌운다.
 * 목록에 없는 항목은 무시한다 — 시드에 없는 id 는 D2 에도 만들 방법이 없었다.
 */
export function applyLegacyBehaviorSettings(
  behaviors: Behavior[],
  legacy: LegacyBehaviorSetting[] | null | undefined
): Behavior[] {
  if (!legacy?.length) return normalizeBehaviors(behaviors)

  const byId = new Map(legacy.map((s) => [s.behaviorId, s]))
  return normalizeBehaviors(
    behaviors.map((behavior) => {
      const saved = byId.get(behavior.id)
      if (!saved || behavior.rule.kind !== 'interval') return behavior
      return {
        ...behavior,
        enabled: typeof saved.enabled === 'boolean' ? saved.enabled : behavior.enabled,
        rule: {
          kind: 'interval' as const,
          everyMs: clampMinutes(saved.everyMinutes, intervalMinutes(behavior)) * MIN,
        },
      }
    })
  )
}
