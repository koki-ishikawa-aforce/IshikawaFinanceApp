import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** SectionB（初期残高登録）完了イベント（08f §3） */
export const SectionBCompletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('SectionBCompleted'),
  userId: UserIdSchema,
  completedAt: z.date(),
})
export type SectionBCompleted = z.infer<typeof SectionBCompletedSchema>
