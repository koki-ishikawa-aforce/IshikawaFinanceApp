import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { UserIdSchema } from '../../shared/ids'
import { UserRoleSchema } from '../../shared/value-objects/UserRole'

/** ユーザー新規登録イベント（08f §3） */
export const AppUserRegisteredSchema = DomainEventBaseSchema.extend({
  type: z.literal('AppUserRegistered'),
  userId: UserIdSchema,
  role: UserRoleSchema,
})
export type AppUserRegistered = z.infer<typeof AppUserRegisteredSchema>
