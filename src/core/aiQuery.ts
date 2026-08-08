/**
 * 「AI로 루틴 찾기」 질의 조립 — IO 없는 순수 모듈. 브라우저를 여는 건 호출부(설정 창)다.
 *
 * D2.6 은 서버도 API 키도 계정도 쓰지 않는다. 사용자의 개별 고민을 행동으로 바꾸는 경로를
 * **기본 브라우저 + 복사·붙여넣기**로 만든다 (근거: docs/decisions/0008).
 * 이 파일이 하는 일은 딱 하나 — 고민을 질의문으로 만들고 구글 AI 모드 URL 로 인코딩하는 것.
 *
 * 앱 내 웹뷰로 구글을 열거나 결과를 HTTP 로 긁지 않는다(스펙 「금지」). 그래서 여기에는
 * 네트워크 코드가 없고, 자동 검증도 **URL 문자열 조립까지만** 한다.
 */

import { BLOCK_CLOSE, BLOCK_OPEN } from './routineParse'

/** 구글 AI 모드. `udm=50` 이 그 모드의 식별자다 */
const SEARCH_BASE = 'https://www.google.com/search'
const AI_MODE_PARAM = 'udm=50'

/** 입력 상한(코드포인트). 여기서 잘라야 질의 전체 길이가 결정론적으로 묶인다 */
export const MAX_JOB_LENGTH = 40
export const MAX_SYMPTOM_LENGTH = 120

/**
 * 조립된 질의문의 길이 상한. 브라우저·서버가 받아주는 URL 한계를 넘지 않는지 확인하는
 * 기준값이다 — 입력을 먼저 자르므로 실제로는 이 값에 도달할 수 없다(테스트가 지킨다).
 * 질의문 **끝**에 출력 형식 지시가 오기 때문에 조립 후 자르는 방식은 쓸 수 없다.
 */
export const MAX_QUERY_LENGTH = 800

export interface RoutineQueryInput {
  /** 직군·자세. 예: "사무직, 하루 종일 앉아서 코딩" */
  job: string
  /** 증상. 예: "어깨가 뻐근하고 눈이 침침함" */
  symptom: string
}

/**
 * 줄바꿈·연속 공백을 한 칸으로 눌러서 자른다. 사용자 입력이 질의 구조를 깨뜨리지 못하게.
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
 * 고민 → 질의문.
 *
 * 근거를 **요청**은 하되, 앱이 효용을 단정하지는 않는다 (CLAUDE.md 규칙 6). 돌아온 문구는
 * 우리가 지어낸 게 아니라 사용자가 가져와 확인한 것이고, 미리보기 화면에 고지가 함께 뜬다.
 */
export function buildRoutineQuery(input: RoutineQueryInput): string {
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

/** 기본 브라우저로 열 구글 AI 모드 URL. 여는 건 `tauri-plugin-opener` 가 한다. */
export function buildRoutineSearchUrl(input: RoutineQueryInput): string {
  return `${SEARCH_BASE}?${AI_MODE_PARAM}&q=${encodeURIComponent(buildRoutineQuery(input))}`
}
