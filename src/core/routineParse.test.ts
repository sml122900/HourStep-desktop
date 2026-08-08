import { describe, expect, it } from 'vitest'
import {
  MAX_BEHAVIORS,
  MAX_INTERVAL_MINUTES,
  MAX_LABEL_LENGTH,
  MAX_MESSAGE_LENGTH,
  MIN_INTERVAL_MINUTES,
  intervalMinutes,
  normalizeBehaviors,
} from './behaviors'
import {
  MAX_PARSED_LABEL_LENGTH,
  MAX_PARSED_MESSAGE_LENGTH,
  ROUTINE_FALLBACK_EMOJI,
  parseRoutineBlock,
  routineItemsToBehaviors,
} from './routineParse'
import { seedBehaviors } from './presets'

/** 블록 본문만 주면 앞뒤 설명까지 붙여 "실제 답변처럼" 만든다 */
const wrap = (body: string) =>
  `추천 루틴은 다음과 같습니다.\n\n[HOURSTEP]\n${body}\n[/HOURSTEP]\n\n참고하세요.`

describe('parseRoutineBlock — 정상', () => {
  it('블록 안의 4필드 줄을 항목으로 만든다', () => {
    const got = parseRoutineBlock(
      wrap(
        '🦾|어깨 돌리기|25|어깨를 천천히 뒤로 돌려주세요\n👀|먼 곳 보기|20|창밖 먼 곳을 20초 봐주세요'
      )
    )

    expect(got.ok).toBe(true)
    expect(got.reason).toBe('ok')
    expect(got.skipped).toBe(0)
    expect(got.items).toEqual([
      { emoji: '🦾', label: '어깨 돌리기', minutes: 25, message: '어깨를 천천히 뒤로 돌려주세요' },
      { emoji: '👀', label: '먼 곳 보기', minutes: 20, message: '창밖 먼 곳을 20초 봐주세요' },
    ])
  })

  it('간격 경계값(1분·480분)은 통과한다', () => {
    for (const minutes of [MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES]) {
      const got = parseRoutineBlock(wrap(`🔔|테스트|${minutes}|문구`))
      expect(got.items[0]?.minutes).toBe(minutes)
    }
  })
})

describe('parseRoutineBlock — 필수 케이스', () => {
  it('블록이 없으면 실패한다 (에러가 아니라 폴백 신호)', () => {
    const got = parseRoutineBlock('스트레칭을 자주 하시는 게 좋습니다. 25분마다 어깨를 돌려보세요.')
    expect(got.ok).toBe(false)
    expect(got.reason).toBe('no-block')
    expect(got.items).toEqual([])
  })

  it('빈 블록이면 실패한다', () => {
    expect(parseRoutineBlock(wrap('')).reason).toBe('empty-block')
    expect(parseRoutineBlock(wrap('   \n\n  ')).reason).toBe('empty-block')
  })

  it('블록이 여러 개면 항목이 나오는 마지막 블록을 쓴다', () => {
    const text =
      '형식은 이렇습니다.\n[HOURSTEP]\n이모지|행동이름|간격(분)|알림문구\n[/HOURSTEP]\n' +
      '실제 추천은 아래와 같습니다.\n[HOURSTEP]\n💧|물마시기|40|물 한 잔 마셔요\n[/HOURSTEP]'

    const got = parseRoutineBlock(text)
    expect(got.ok).toBe(true)
    expect(got.items).toHaveLength(1)
    expect(got.items[0].label).toBe('물마시기')
  })

  it('뒤쪽 블록이 비어 있으면 앞쪽에서 찾는다', () => {
    const got = parseRoutineBlock(
      '[HOURSTEP]\n💧|물마시기|40|물 한 잔 마셔요\n[/HOURSTEP]\n[HOURSTEP]\n[/HOURSTEP]'
    )
    expect(got.items).toHaveLength(1)
    expect(got.items[0].label).toBe('물마시기')
  })

  it('템플릿 예시 줄만 있으면 빈 블록으로 본다 (형식 오류로 세지 않는다)', () => {
    const got = parseRoutineBlock(wrap('이모지|행동이름|간격(분)|알림문구'))
    expect(got.reason).toBe('empty-block')
    expect(got.skipped).toBe(0)
  })

  it('코드펜스로 감싸여 있어도 읽는다', () => {
    const got = parseRoutineBlock(
      '```\n[HOURSTEP]\n🧘|허리 펴기|45|의자에서 일어나 허리를 펴주세요\n[/HOURSTEP]\n```'
    )
    expect(got.ok).toBe(true)
    expect(got.items[0].label).toBe('허리 펴기')
  })

  it('전각 파이프를 구분자로 인정한다', () => {
    const got = parseRoutineBlock(wrap('💧｜물마시기｜30｜물 한 잔 마셔요'))
    expect(got.ok).toBe(true)
    expect(got.items[0]).toEqual({
      emoji: '💧',
      label: '물마시기',
      minutes: 30,
      message: '물 한 잔 마셔요',
    })
  })

  it('마크다운 볼드·불릿·표 형식이 섞여도 읽는다', () => {
    const got = parseRoutineBlock(
      wrap(
        '- **🧘**|**허리 펴기**|45|허리를 펴주세요\n' +
          '| 👀 | 먼 곳 보기 | 20 | 창밖을 봐주세요 |\n' +
          '2) 💧|물마시기|30|물 한 잔 마셔요'
      )
    )
    expect(got.ok).toBe(true)
    expect(got.items.map((i) => i.label)).toEqual(['허리 펴기', '먼 곳 보기', '물마시기'])
    expect(got.skipped).toBe(0)
  })

  it('간격에 "30분" 처럼 글자가 섞여도 숫자를 뽑는다', () => {
    const got = parseRoutineBlock(
      wrap('💧|물마시기|30분마다|물 한 잔 마셔요\n🧘|허리 펴기|45 min|허리를 펴주세요')
    )
    expect(got.items.map((i) => i.minutes)).toEqual([30, 45])
  })

  it('필드 수가 안 맞는 줄만 건너뛰고 나머지는 살린다', () => {
    const got = parseRoutineBlock(
      wrap('💧|물마시기|30|물 한 잔 마셔요\n이건 그냥 설명 문장입니다\n👀|먼 곳|20')
    )
    expect(got.ok).toBe(true)
    expect(got.items).toHaveLength(1)
    expect(got.reason).toBe('partial')
    expect(got.skipped).toBe(2)
  })
})

describe('parseRoutineBlock — 항목 단위 검증', () => {
  it('간격이 범위 밖이면 그 항목만 버린다', () => {
    for (const bad of ['0', '-5', String(MAX_INTERVAL_MINUTES + 1), '없음']) {
      const got = parseRoutineBlock(wrap(`💧|물마시기|${bad}|물 한 잔 마셔요`))
      expect(got.ok).toBe(false)
      expect(got.reason).toBe('empty-block')
    }
  })

  it('이름·문구가 비었거나 터무니없이 길면 그 항목을 버린다', () => {
    const long = (n: number) => 'ㄱ'.repeat(n)
    const bad = [
      `💧||30|물 한 잔 마셔요`,
      `💧|물마시기|30|`,
      `💧|${long(MAX_PARSED_LABEL_LENGTH + 1)}|30|문구`,
      `💧|물마시기|30|${long(MAX_PARSED_MESSAGE_LENGTH + 1)}`,
    ]
    for (const line of bad) expect(parseRoutineBlock(wrap(line)).items).toHaveLength(0)
  })

  it('저장 상한을 넘는 이름·문구는 버리지 않고 자른다 (미리보기에서 고칠 수 있다)', () => {
    const got = parseRoutineBlock(
      wrap(
        `💧|${'ㄱ'.repeat(MAX_PARSED_LABEL_LENGTH)}|30|${'ㄴ'.repeat(MAX_PARSED_MESSAGE_LENGTH)}`
      )
    )
    expect([...got.items[0].label]).toHaveLength(MAX_LABEL_LENGTH)
    expect([...got.items[0].message]).toHaveLength(MAX_MESSAGE_LENGTH)
  })

  it('이모지가 없거나 이모지가 아니면 기본값으로 대체한다', () => {
    for (const field of ['', '스트레칭', 'A', '1', '🧘🧘🧘🧘🧘']) {
      const got = parseRoutineBlock(wrap(`${field}|물마시기|30|물 한 잔 마셔요`))
      expect(got.items[0]?.emoji).toBe(ROUTINE_FALLBACK_EMOJI)
    }
  })

  it('항목 수는 행동 상한을 넘지 않는다', () => {
    const lines = Array.from({ length: MAX_BEHAVIORS + 5 }, (_, i) => `💧|행동${i}|30|문구`)
    expect(parseRoutineBlock(wrap(lines.join('\n'))).items).toHaveLength(MAX_BEHAVIORS)
  })
})

describe('routineItemsToBehaviors', () => {
  const items = [
    { emoji: '🦾', label: '어깨 돌리기', minutes: 25, message: '어깨를 돌려주세요' },
    { emoji: '👀', label: '먼 곳 보기', minutes: 20, message: '창밖을 봐주세요' },
  ]

  it('기존 목록 뒤에 source=ai 로 붙인다', () => {
    const got = routineItemsToBehaviors(seedBehaviors(), items, 1_700_000_000_000)

    expect(got).toHaveLength(5)
    expect(got.slice(0, 3).every((b) => b.source === 'user')).toBe(true)

    const added = got.slice(3)
    expect(added.map((b) => b.source)).toEqual(['ai', 'ai'])
    expect(added.map((b) => b.isBuiltin)).toEqual([false, false])
    expect(added.map((b) => b.label)).toEqual(['어깨 돌리기', '먼 곳 보기'])
    expect(added.map(intervalMinutes)).toEqual([25, 20])
    expect(added.every((b) => b.enabled)).toBe(true)
  })

  it('id 가 겹치지 않는다 — 같은 밀리초에 두 번 넣어도', () => {
    const now = 1_700_000_000_000
    const first = routineItemsToBehaviors([], items, now)
    const second = routineItemsToBehaviors(first, items, now)
    expect(new Set(second.map((b) => b.id)).size).toBe(second.length)
  })

  it('정규화를 거쳐도 source 가 살아남는다 (DB 왕복 전후가 같아야 한다)', () => {
    const got = normalizeBehaviors(routineItemsToBehaviors(seedBehaviors(), items, 1))
    expect(got.filter((b) => b.source === 'ai')).toHaveLength(2)
    expect(got.map((b) => b.sortOrder)).toEqual([0, 1, 2, 3, 4])
  })
})
