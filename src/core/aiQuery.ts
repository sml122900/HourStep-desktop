/**
 * 「AI로 루틴 찾기」 프롬프트 조립 — IO 없는 순수 모듈.
 * 브라우저를 열고 클립보드에 넣는 건 호출부(설정 창)다.
 *
 * D2.6 은 서버도 API 키도 계정도 쓰지 않는다. 사용자의 개별 고민을 행동으로 바꾸는 경로를
 * **기본 브라우저 + 복사·붙여넣기**로 만든다 (근거: docs/decisions/0008).
 *
 * 이 파일이 하는 일은 둘 — ① 고민을 프롬프트로 조립하고 ② 어디로 보낼지(AI_TARGETS)를 안다.
 * 프롬프트를 URL 에 몰래 태우고 끝내지 않는다: 화면에 전문을 보여주고 복사해서 보낸다.
 * 그래야 사용자가 무엇을 보내는지 알고, 구글이 아닌 AI 도 쓸 수 있다.
 *
 * 앱 내 웹뷰로 AI 를 열거나 결과를 HTTP 로 긁지 않는다(스펙 「금지」). 그래서 여기에는
 * 네트워크 코드가 없고, 자동 검증도 **문자열 조립까지만** 한다.
 */

import { BLOCK_CLOSE, BLOCK_OPEN } from './routineParse'

/** 입력 상한(코드포인트). 여기서 잘라야 프롬프트 전체 길이가 결정론적으로 묶인다 */
export const MAX_JOB_LENGTH = 40
export const MAX_SYMPTOM_LENGTH = 120

/**
 * 조립된 프롬프트의 길이 상한. 프롬프트를 q 파라미터로 싣는 대상(구글)에서 URL 이
 * 터무니없이 길어지지 않는지 확인하는 기준값이다 — 입력을 먼저 자르므로 실제로는
 * 이 값에 도달할 수 없다(테스트가 지킨다). 프롬프트 **끝**에 출력 형식 지시가 오기 때문에
 * 조립 후 자르는 방식은 쓸 수 없다.
 */
export const MAX_PROMPT_LENGTH = 800

export interface RoutineQueryInput {
  /** 직군·자세. 예: "사무직, 하루 종일 앉아서 코딩" */
  job: string
  /** 증상. 예: "어깨가 뻐근하고 눈이 침침함" */
  symptom: string
}

export type AiTargetId =
  'google' | 'qwen' | 'perplexity' | 'kimi' | 'grok' | 'gemini' | 'deepseek' | 'claude' | 'chatgpt'

export interface AiTarget {
  id: AiTargetId
  /** 서비스 이름 (고유명사라 문구 상수로 빼지 않는다) */
  name: string
  /**
   * 화면에 어떻게 놓이는가. `search` 는 버튼 하나로 바로 가고, `chat` 은 드롭다운에서 고른다.
   *
   * **`injectsPrompt` 와 겸용하지 않는다.** 지금은 두 값이 우연히 같이 움직이지만
   * (구글만 search 이자 유일한 주입 대상) 의미가 다르다 — 한 열에 두 의미를 태우면
   * 둘 중 하나는 언젠가 어긋난다. ChatGPT 처럼 `?q=` 를 받는 채팅형이 나중에 주입 대상이
   * 되더라도 드롭다운에 남아야 한다 (같은 논지: docs/decisions/0008).
   */
  kind: 'search' | 'chat'
  /**
   * 프롬프트를 URL 에 실을 수 있는가.
   *
   * 구글만 검색어 파라미터(`q`)로 주입된다. 채팅형은 홈만 열리므로 사용자가
   * 직접 붙여넣어야 한다 — 버튼 문구가 그 사실을 밝힌다. 그래서 **어느 쪽이든 이동 시
   * 클립보드에 넣는 것**이 이 기능의 핵심 동작이다(복사 없이 이동하면 무의미하다).
   *
   * 일부 채팅형도 `?q=` 를 받지만 켜 두지 않았다. 서비스마다 파라미터 이름과 지원 여부가
   * 다르고 예고 없이 바뀌는데, **틀리면 프롬프트가 조용히 사라진 채 빈 채팅이 열린다.**
   * 클립보드 경로는 어디서든 똑같이 동작한다.
   */
  injectsPrompt: boolean
}

/**
 * 이동할 AI 목록 — **도메인은 여기에만 적는다.** 서비스 주소는 바뀐다
 * (chat.openai.com → chatgpt.com 처럼). UI·테스트 전부 이 상수를 참조한다.
 *
 * 채팅형은 **영문 이름 알파벳 내림차순**이다. 우열을 매기지 않으려는 것 —
 * 어느 AI를 쓸지는 사용자가 이미 정해 두고 오는 선택이라 앱이 순위를 제시할 이유가 없다.
 */
export const AI_TARGETS: readonly AiTarget[] = [
  { id: 'google', name: '구글 AI 모드', kind: 'search', injectsPrompt: true },
  { id: 'qwen', name: 'Qwen', kind: 'chat', injectsPrompt: false },
  { id: 'perplexity', name: 'Perplexity', kind: 'chat', injectsPrompt: false },
  { id: 'kimi', name: 'Kimi', kind: 'chat', injectsPrompt: false },
  { id: 'grok', name: 'Grok', kind: 'chat', injectsPrompt: false },
  { id: 'gemini', name: 'Gemini', kind: 'chat', injectsPrompt: false },
  { id: 'deepseek', name: 'DeepSeek', kind: 'chat', injectsPrompt: false },
  { id: 'claude', name: 'Claude', kind: 'chat', injectsPrompt: false },
  { id: 'chatgpt', name: 'ChatGPT', kind: 'chat', injectsPrompt: false },
]

/** 버튼으로 내놓는 것 (지금은 구글 하나) */
export const SEARCH_TARGETS: readonly AiTarget[] = AI_TARGETS.filter((t) => t.kind === 'search')

/** 드롭다운에 넣는 것. 늘어나도 버튼이 줄줄이 늘어나지 않는다 */
export const CHAT_TARGETS: readonly AiTarget[] = AI_TARGETS.filter((t) => t.kind === 'chat')

/**
 * 드롭다운의 초기 선택. 목록 순서(내림차순)와 무관하게 정한다 —
 * 첫 줄이 기본값이면 정렬 규칙이 곧 추천이 돼 버린다.
 */
export const DEFAULT_CHAT_TARGET_ID: AiTargetId = 'chatgpt'

/** 대상별 진입 주소. `udm=50` 은 구글 AI 모드의 식별자다. */
const TARGET_URL: Record<AiTargetId, string> = {
  google: 'https://www.google.com/search?udm=50',
  qwen: 'https://chat.qwen.ai/',
  perplexity: 'https://www.perplexity.ai/',
  kimi: 'https://www.kimi.com/',
  grok: 'https://grok.com/',
  gemini: 'https://gemini.google.com/app',
  deepseek: 'https://chat.deepseek.com/',
  claude: 'https://claude.ai/new',
  chatgpt: 'https://chatgpt.com/',
}

/** id → 대상. 드롭다운이 문자열만 들고 있으므로 되돌릴 길이 필요하다 */
export function aiTargetById(id: string): AiTarget | undefined {
  return AI_TARGETS.find((t) => t.id === id)
}

/**
 * 줄바꿈·연속 공백을 한 칸으로 눌러서 자른다. 사용자 입력이 프롬프트 구조를 깨뜨리지 못하게.
 * 블록 표식도 지운다 — 입력에 `[/HOURSTEP]` 이 섞여 들어오면 형식 지시가 두 겹이 된다.
 */
function flatten(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const collapsed = value
    .replace(new RegExp(`\\[/?${BLOCK_OPEN.slice(1, -1)}\\]`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const points = [...collapsed]
  return points.length <= max ? collapsed : points.slice(0, max).join('')
}

/**
 * 출력 형식 지시 — 사용자가 직접 쓴 문구다. 임의로 고치지 않는다 (CLAUDE.md 규칙 8).
 * 표식은 파서(`routineParse.ts`)와 **같은 상수**를 쓴다. 한쪽만 바뀌면 파싱이 통째로 실패한다.
 */
const FORMAT_INSTRUCTION = [
  '답변 마지막에 아래 형식으로 정리해줘. 다른 설명 없이 이 블록만:',
  BLOCK_OPEN,
  '이모지|행동이름|간격(분)|알림문구',
  '이모지|행동이름|간격(분)|알림문구',
  BLOCK_CLOSE,
].join('\n')

/**
 * 고민 → 프롬프트. 화면에 **전문이 그대로 보이는** 문자열이고, 클립보드에 들어가는 것도 이것이다.
 *
 * 근거를 **요청**은 하되, 앱이 효용을 단정하지는 않는다 (CLAUDE.md 규칙 6). 돌아온 문구는
 * 우리가 지어낸 게 아니라 사용자가 가져와 확인한 것이고, 미리보기 화면에 고지가 함께 뜬다.
 */
export function buildRoutinePrompt(input: RoutineQueryInput): string {
  const job = flatten(input.job, MAX_JOB_LENGTH)
  const symptom = flatten(input.symptom, MAX_SYMPTOM_LENGTH)

  const who = job ? `나는 ${job}.` : '나는 앉아서 일하는 시간이 길어.'
  const pain = symptom ? ` 요즘 ${symptom} 같은 불편이 있어.` : ''

  return [
    `${who}${pain}`,
    '근무 중 자리에서 바로 할 수 있는 짧은 휴식 행동을 3~5가지 추천해줘.',
    '각각 몇 분 간격으로 하면 좋은지와, 그렇게 권하는 근거(연구·가이드라인)도 같이 알려줘.',
    '행동이름은 10자 이내, 알림문구는 40자 이내로 써줘.',
    '',
    FORMAT_INSTRUCTION,
  ].join('\n')
}

/**
 * 기본 브라우저로 열 주소. 프롬프트를 실을 수 있는 대상이면 싣고, 아니면 홈으로 보낸다.
 * 여는 건 `tauri-plugin-opener` 가 한다 — 앱 내 웹뷰로 열지 않는다.
 */
export function buildAiUrl(target: AiTarget, prompt: string): string {
  const base = TARGET_URL[target.id]
  if (!target.injectsPrompt) return base
  // 주소가 바뀌어 쿼리 없는 형태가 돼도 깨지지 않게 구분자를 판단해서 붙인다
  return `${base}${base.includes('?') ? '&' : '?'}q=${encodeURIComponent(prompt)}`
}
