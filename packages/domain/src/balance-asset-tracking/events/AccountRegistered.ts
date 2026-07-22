/**
 * 口座登録イベント（08d §3）
 * data 口座登録イベント = ユーザーID AND 口座ID AND 口座種別 AND 発生日時
 */
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema, UserIdSchema } from '../../shared/ids'
import { AccountKindSchema } from '../aggregates/Account'

export const AccountRegisteredSchema = DomainEventBaseSchema.extend({
  type: z.literal('AccountRegistered'),
  userId: UserIdSchema,
  accountId: AccountIdSchema,
  accountKind: AccountKindSchema,
})
export type AccountRegistered = z.infer<typeof AccountRegisteredSchema>
