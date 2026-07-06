import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** SectionF スキップイベント（08f §3。スキップ可の Section） */
export const SectionFSkippedSchema = DomainEventBaseSchema.extend({
  type: z.literal('SectionFSkipped'),
  userId: UserIdSchema,
  skippedAt: z.date(),
})
export type SectionFSkipped = z.infer<typeof SectionFSkippedSchema>
