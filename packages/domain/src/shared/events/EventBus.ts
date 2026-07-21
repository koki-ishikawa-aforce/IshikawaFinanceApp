import type { DomainEventBase } from './DomainEvent'

export type DomainEvent = DomainEventBase & { readonly type: string }

export type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => void

export interface EventBus {
  publish(event: DomainEvent): void
  subscribe<E extends DomainEvent>(eventType: E['type'], handler: EventHandler<E>): void
  clear(): void
}
