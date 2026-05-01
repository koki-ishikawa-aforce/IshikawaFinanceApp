/**
 * ドメインイベント基底
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.3
 *
 * Phase 4 では型定義のみ。実配信（イベントバス）は Phase 5 以降。
 */
import { z } from 'zod'

export const DomainEventBaseSchema = z.object({
  eventId: z.string().min(1),
  occurredAt: z.date(),
})
export type DomainEventBase = z.infer<typeof DomainEventBaseSchema>
