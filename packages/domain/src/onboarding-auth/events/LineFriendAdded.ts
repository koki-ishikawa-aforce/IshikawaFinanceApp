import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** LINE 友達追加イベント（08f §3。follow webhook 受信） */
export const LineFriendAddedSchema = DomainEventBaseSchema.extend({
  type: z.literal('LineFriendAdded'),
  userId: UserIdSchema,
  receivedAt: z.date(),
})
export type LineFriendAdded = z.infer<typeof LineFriendAddedSchema>
