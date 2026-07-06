import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema, ImportJobIdSchema } from '../../shared/ids'

/** SectionF（過去明細取込）完了イベント（08f §3） */
export const SectionFCompletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('SectionFCompleted'),
  userId: UserIdSchema,
  importJobId: ImportJobIdSchema,
})
export type SectionFCompleted = z.infer<typeof SectionFCompletedSchema>
