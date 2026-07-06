import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** OAuth認可開始イベント（08f §3） */
export const OauthAuthorizationStartedSchema = DomainEventBaseSchema.extend({
  type: z.literal('OauthAuthorizationStarted'),
  userId: UserIdSchema,
  startedAt: z.date(),
})
export type OauthAuthorizationStarted = z.infer<typeof OauthAuthorizationStartedSchema>
