import type { DomainEvent, EventBus, EventHandler } from './EventBus'

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, EventHandler[]>()

  async publish(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type)
    if (!handlers) return
    for (const handler of handlers) {
      await handler(event)
    }
  }

  subscribe<E extends DomainEvent>(eventType: E['type'], handler: EventHandler<E>): void {
    const existing = this.handlers.get(eventType)
    if (existing) {
      existing.push(handler as EventHandler)
    } else {
      this.handlers.set(eventType, [handler as EventHandler])
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}
