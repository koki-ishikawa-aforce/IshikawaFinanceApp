import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryEventBus } from '../../../src/shared/events/InMemoryEventBus'
import type { DomainEvent, EventHandler } from '../../../src/shared/events/EventBus'

type TestEventA = DomainEvent & {
  readonly type: 'TestEventA'
  readonly value: number
}

type TestEventB = DomainEvent & {
  readonly type: 'TestEventB'
  readonly message: string
}

function makeEvent<E extends DomainEvent>(overrides: Omit<E, 'eventId' | 'occurredAt'> & Partial<Pick<E, 'eventId' | 'occurredAt'>>): E {
  return {
    eventId: 'evt-1',
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as E
}

describe('InMemoryEventBus', () => {
  let bus: InMemoryEventBus

  beforeEach(() => {
    bus = new InMemoryEventBus()
  })

  it('ハンドラ未登録のイベントを publish してもエラーにならない', () => {
    const event = makeEvent<TestEventA>({ type: 'TestEventA', value: 1 })
    expect(() => bus.publish(event)).not.toThrow()
  })

  it('登録したハンドラにイベントが配信される', () => {
    const received: TestEventA[] = []
    bus.subscribe<TestEventA>('TestEventA', (e) => received.push(e))

    const event = makeEvent<TestEventA>({ type: 'TestEventA', value: 42 })
    bus.publish(event)

    expect(received).toHaveLength(1)
    expect(received[0]!.value).toBe(42)
  })

  it('同一イベント型に複数ハンドラを登録できる', () => {
    const log1: number[] = []
    const log2: number[] = []
    bus.subscribe<TestEventA>('TestEventA', (e) => log1.push(e.value))
    bus.subscribe<TestEventA>('TestEventA', (e) => log2.push(e.value))

    bus.publish(makeEvent<TestEventA>({ type: 'TestEventA', value: 7 }))

    expect(log1).toEqual([7])
    expect(log2).toEqual([7])
  })

  it('異なるイベント型のハンドラは呼ばれない', () => {
    const receivedA: TestEventA[] = []
    const receivedB: TestEventB[] = []
    bus.subscribe<TestEventA>('TestEventA', (e) => receivedA.push(e))
    bus.subscribe<TestEventB>('TestEventB', (e) => receivedB.push(e))

    bus.publish(makeEvent<TestEventA>({ type: 'TestEventA', value: 1 }))

    expect(receivedA).toHaveLength(1)
    expect(receivedB).toHaveLength(0)
  })

  it('publish は同期的に全ハンドラを実行する', () => {
    const order: string[] = []
    bus.subscribe<TestEventA>('TestEventA', () => order.push('first'))
    bus.subscribe<TestEventA>('TestEventA', () => order.push('second'))

    bus.publish(makeEvent<TestEventA>({ type: 'TestEventA', value: 0 }))

    expect(order).toEqual(['first', 'second'])
  })

  it('clear() で全ハンドラが解除される', () => {
    const received: TestEventA[] = []
    bus.subscribe<TestEventA>('TestEventA', (e) => received.push(e))

    bus.clear()
    bus.publish(makeEvent<TestEventA>({ type: 'TestEventA', value: 99 }))

    expect(received).toHaveLength(0)
  })

  it('clear() 後に再登録できる', () => {
    const received: number[] = []
    bus.subscribe<TestEventA>('TestEventA', (e) => received.push(e.value))
    bus.clear()

    bus.subscribe<TestEventA>('TestEventA', (e) => received.push(e.value * 10))
    bus.publish(makeEvent<TestEventA>({ type: 'TestEventA', value: 3 }))

    expect(received).toEqual([30])
  })

  it('ハンドラはべき等に動作可能（同一イベントの再配信）', () => {
    const seen = new Set<string>()
    const handler: EventHandler<TestEventA> = (e) => {
      seen.add(e.eventId)
    }
    bus.subscribe<TestEventA>('TestEventA', handler)

    const event = makeEvent<TestEventA>({ type: 'TestEventA', value: 1 })
    bus.publish(event)
    bus.publish(event)

    expect(seen.size).toBe(1)
  })

  it('ハンドラが例外を投げると呼び出し元に伝播する', () => {
    bus.subscribe<TestEventA>('TestEventA', () => {
      throw new Error('handler failure')
    })

    const event = makeEvent<TestEventA>({ type: 'TestEventA', value: 0 })
    expect(() => bus.publish(event)).toThrow('handler failure')
  })
})
