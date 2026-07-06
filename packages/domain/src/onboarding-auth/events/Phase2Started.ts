import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** Phase2開始イベント（08f §3） */
export const Phase2StartedSchema = DomainEventBaseSchema.extend({
  type: z.literal('Phase2Started'),
  userId: UserIdSchema,
  startedAt: z.date(),
})
export type Phase2Started = z.infer<typeof Phase2StartedSchema>
