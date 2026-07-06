import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'

/** アクセス拒否イベント（08f §3。許可リスト不一致） */
export const AccessDeniedSchema = DomainEventBaseSchema.extend({
  type: z.literal('AccessDenied'),
  lineUserId: UserIdSchema,
  reason: z.literal('allowlist_mismatch'),
})
export type AccessDenied = z.infer<typeof AccessDeniedSchema>
