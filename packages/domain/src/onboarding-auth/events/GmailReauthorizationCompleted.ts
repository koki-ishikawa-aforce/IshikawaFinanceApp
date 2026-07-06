import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** Gmail再認可完了イベント（08f §3） */
export const GmailReauthorizationCompletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('GmailReauthorizationCompleted'),
  userId: UserIdSchema,
  reauthorizedAt: z.date(),
})
export type GmailReauthorizationCompleted = z.infer<typeof GmailReauthorizationCompletedSchema>
