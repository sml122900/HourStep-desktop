import { describe, expect, it } from 'vitest'
import { MAX_QUEUED, dequeueOccurrence, enqueueOccurrence, summarizeQueue } from './overlayQueue'
import { occurrenceId } from './scheduler'
import type { Occurrence } from './types'

const at = (behaviorId: string, dueAt: number): Occurrence => ({
  behaviorId,
  dueAt,
  origin: 'regular',
})

/** 상한까지 채운 큐 (dueAt 1..MAX_QUEUED 분) */
function full(): Occurrence[] {
  let queue: Occurrence[] = []
  for (let i = 1; i <= MAX_QUEUED; i++) queue = enqueueOccurrence(queue, at(`b${i}`, i)).queue
  return queue
}

describe('enqueueOccurrence', () => {
  it('뒤에 붙이고 원본을 건드리지 않는다', () => {
    const queue = [at('water', 100)]
    const got = enqueueOccurrence(queue, at('stretch', 200))

    expect(got.queue.map((o) => o.behaviorId)).toEqual(['water', 'stretch'])
    expect(got.dropped).toEqual([])
    expect(queue).toHaveLength(1)
  })

  it('원래 dueAt 을 그대로 들고 있는다 — 지연은 사실이다', () => {
    const got = enqueueOccurrence([], at('water', 12_345))
    expect(got.queue[0].dueAt).toBe(12_345)
  })

  it('같은 occurrence 가 두 번 들어오면 무시한다', () => {
    const once = enqueueOccurrence([], at('water', 100))
    const twice = enqueueOccurrence(once.queue, at('water', 100))

    expect(twice.queue).toHaveLength(1)
    expect(twice.dropped).toEqual([])
  })

  it('같은 행동이라도 dueAt 이 다르면 별개로 쌓인다', () => {
    const first = enqueueOccurrence([], at('water', 100))
    const second = enqueueOccurrence(first.queue, at('water', 200))
    expect(second.queue).toHaveLength(2)
  })

  it('상한을 넘으면 오래된 것부터 버린다', () => {
    const got = enqueueOccurrence(full(), at('new', 999))

    expect(got.queue).toHaveLength(MAX_QUEUED)
    expect(got.dropped.map((o) => o.behaviorId)).toEqual(['b1'])
    expect(got.queue[0].behaviorId).toBe('b2')
    expect(got.queue[MAX_QUEUED - 1].behaviorId).toBe('new')
  })

  it('상한이 0 이면 아무것도 담지 않고 전부 버린다', () => {
    const got = enqueueOccurrence([], at('water', 100), 0)
    expect(got.queue).toEqual([])
    expect(got.dropped.map((o) => o.behaviorId)).toEqual(['water'])
  })
})

describe('dequeueOccurrence', () => {
  it('빈 큐에서 꺼내면 null — 호출부는 그냥 카드를 닫는다', () => {
    expect(dequeueOccurrence([])).toEqual({ next: null, rest: [] })
  })

  it('넣은 순서대로 꺼낸다 (FIFO)', () => {
    const queue = full()
    const first = dequeueOccurrence(queue)
    const second = dequeueOccurrence(first.rest)

    expect(first.next!.behaviorId).toBe('b1')
    expect(second.next!.behaviorId).toBe('b2')
    expect(second.rest).toHaveLength(MAX_QUEUED - 2)
    // 원본은 그대로
    expect(queue).toHaveLength(MAX_QUEUED)
  })

  it('마지막 한 건을 꺼내면 빈 큐가 된다', () => {
    const { next, rest } = dequeueOccurrence([at('water', 100)])
    expect(next!.behaviorId).toBe('water')
    expect(rest).toEqual([])
  })
})

describe('summarizeQueue', () => {
  it('빈 큐도 한 줄로 찍는다', () => {
    expect(summarizeQueue([])).toBe('queue n=0')
  })

  it('occurrenceId 로 찍는다 — CompletionLog 와 같은 식별자', () => {
    const queue = [at('water', 100), at('eyes', 200)]
    expect(summarizeQueue(queue)).toBe(
      `queue n=2 ${occurrenceId(queue[0])} ${occurrenceId(queue[1])}`
    )
  })
})
