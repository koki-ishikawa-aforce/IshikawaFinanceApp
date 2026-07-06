import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** Gmail連携完了イベント（08f §3） */
export const GmailLinkCompletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('GmailLinkCompleted'),
  userId: UserIdSchema,
  authorizedAt: z.date(),
})
export type GmailLinkCompleted = z.infer<typeof GmailLinkCompletedSchema>
