import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** Phase2完了イベント（08f §3） */
export const Phase2CompletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('Phase2Completed'),
  userId: UserIdSchema,
  completedAt: z.date(),
})
export type Phase2Completed = z.infer<typeof Phase2CompletedSchema>
