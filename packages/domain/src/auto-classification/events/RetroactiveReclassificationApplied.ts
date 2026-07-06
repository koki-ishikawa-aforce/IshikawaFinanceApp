import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** 過去未分類が一括再分類されたイベント（08b §3、J-3） */
export const RetroactiveReclassificationAppliedSchema = DomainEventBaseSchema.extend({
  type: z.literal('RetroactiveReclassificationApplied'),
  userId: UserIdSchema,
  targetCount: z.number().int().nonnegative(),
})
export type RetroactiveReclassificationApplied = z.infer<
  typeof RetroactiveReclassificationAppliedSchema
>
