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

function makeEvent<E extends DomainEvent>(
  overrides: Omit<E, 'eventId' | 'occurredAt'> & Partial<Pick<E, 'eventId' | 'occurredAt'>>,
): E {
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

  it('ハンドラ未登録のイベントを publish してもエラーにならない', async () => {
    const event = makeEvent<TestEventA>({ type: 'TestEventA', value: 1 })
    await expect(bus.publish(event)).resolves.toBeUndefined()
  })

  it('登録したハンドラにイベントが配信される', async () => {
    const received: TestEventA[] = []
    bus.subscribe<TestEventA>('TestEventA', e => {
      received.push(e)
    })

    const event = makeEvent<TestEventA>({ type: 'TestEventA', value: 42 })
    await bus.publish(event)

    expect(received).toHaveLength(1)
    expect(received[0]?.value).toBe(42)
  })

  it('同一イベント型に複数ハンドラを登録できる', async () => {
    const log1: number[] = []
    const log2: number[] = []
    bus.subscribe<TestEventA>('TestEventA', e => {
      log1.push(e.value)
    })
    bus.subscribe<TestEventA>('TestEventA', e => {
      log2.push(e.value)
    })

    await bus.publish(makeEvent<TestEventA>({ type: 'TestEventA', value: 7 }))

    expect(log1).toEqual([7])
    expect(log2).toEqual([7])
  })

  it('異なるイベント型のハンドラは呼ばれない', async () => {
    const receivedA: TestEventA[] = []
    const receivedB: TestEventB[] = []
    bus.subscribe<TestEventA>('TestEventA', e => {
      receivedA.push(e)
    })
    bus.subscribe<TestEventB>('TestEventB', e => {
      receivedB.push(e)
    })

    await bus.publish(makeEvent<TestEventA>({ type: 'TestEventA', value: 1 }))

    expect(receivedA).toHaveLength(1)
    expect(receivedB).toHaveLength(0)
  })

  it('publish は登録順に全ハンドラを直列実行する', async () => {
    const order: string[] = []
    bus.subscribe<TestEventA>('TestEventA', () => {
      order.push('first')
    })
    bus.subscribe<TestEventA>('TestEventA', () => {
      order.push('second')
    })

    await bus.publish(makeEvent<TestEventA>({ type: 'TestEventA', value: 0 }))

    expect(order).toEqual(['first', 'second'])
  })

  it('非同期ハンドラの完了を待ってから次のハンドラを実行する', async () => {
    const order: string[] = []
    bus.subscribe<TestEventA>('TestEventA', async () => {
      await Promise.resolve()
      order.push('async-first')
    })
    bus.subscribe<TestEventA>('TestEventA', () => {
      order.push('sync-second')
    })

    await bus.publish(makeEvent<TestEventA>({ type: 'TestEventA', value: 0 }))

    expect(order).toEqual(['async-first', 'sync-second'])
  })

  it('clear() で全ハンドラが解除される', async () => {
    const received: TestEventA[] = []
    bus.subscribe<TestEventA>('TestEventA', e => {
      received.push(e)
    })

    bus.clear()
    await bus.publish(makeEvent<TestEventA>({ type: 'TestEventA', value: 99 }))

    expect(received).toHaveLength(0)
  })

  it('clear() 後に再登録できる', async () => {
    const received: number[] = []
    bus.subscribe<TestEventA>('TestEventA', e => {
      received.push(e.value)
    })
    bus.clear()

    bus.subscribe<TestEventA>('TestEventA', e => {
      received.push(e.value * 10)
    })
    await bus.publish(makeEvent<TestEventA>({ type: 'TestEventA', value: 3 }))

    expect(received).toEqual([30])
  })

  it('ハンドラはべき等に動作可能（同一イベントの再配信）', async () => {
    const seen = new Set<string>()
    const handler: EventHandler<TestEventA> = e => {
      seen.add(e.eventId)
    }
    bus.subscribe<TestEventA>('TestEventA', handler)

    const event = makeEvent<TestEventA>({ type: 'TestEventA', value: 1 })
    await bus.publish(event)
    await bus.publish(event)

    expect(seen.size).toBe(1)
  })

  it('ハンドラが例外を投げると呼び出し元に伝播する', async () => {
    bus.subscribe<TestEventA>('TestEventA', () => {
      throw new Error('handler failure')
    })

    const event = makeEvent<TestEventA>({ type: 'TestEventA', value: 0 })
    await expect(bus.publish(event)).rejects.toThrow('handler failure')
  })

  it('非同期ハンドラの reject も呼び出し元に伝播する', async () => {
    bus.subscribe<TestEventA>('TestEventA', async () => {
      await Promise.resolve()
      throw new Error('async handler failure')
    })

    const event = makeEvent<TestEventA>({ type: 'TestEventA', value: 0 })
    await expect(bus.publish(event)).rejects.toThrow('async handler failure')
  })

  it('配信中に同一型へ subscribe しても当該 publish には影響しない（スナップショット）', async () => {
    const order: string[] = []
    bus.subscribe<TestEventA>('TestEventA', () => {
      order.push('existing')
      // 配信中に新しいハンドラを登録する（配列をミューテートする）
      bus.subscribe<TestEventA>('TestEventA', () => {
        order.push('added-during-publish')
      })
    })

    await bus.publish(makeEvent<TestEventA>({ type: 'TestEventA', value: 1 }))
    // 実行中に追加したハンドラは当該 publish では呼ばれない
    expect(order).toEqual(['existing'])

    // 次の publish 以降では反映される
    await bus.publish(makeEvent<TestEventA>({ type: 'TestEventA', value: 2 }))
    expect(order).toEqual(['existing', 'existing', 'added-during-publish'])
  })
})
