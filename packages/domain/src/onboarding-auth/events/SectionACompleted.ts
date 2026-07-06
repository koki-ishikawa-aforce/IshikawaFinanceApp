import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** SectionA（Gmail 連携）完了イベント（08f §3） */
export const SectionACompletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('SectionACompleted'),
  userId: UserIdSchema,
  completedAt: z.date(),
})
export type SectionACompleted = z.infer<typeof SectionACompletedSchema>
