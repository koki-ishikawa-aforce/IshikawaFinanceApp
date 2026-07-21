import { newUlid } from '@warimaru/adapters-neon'

/** ドメインイベント共通属性（eventId / occurredAt）を発行時に採番する */
export function domainEventBase(occurredAt: Date = new Date()): {
  eventId: string
  occurredAt: Date
} {
  return { eventId: newUlid(), occurredAt }
}
