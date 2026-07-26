/**
 * 口座非アクティブ化イベント（08d §3）
 * data 口座非アクティブ化イベント = 口座ID AND 非アクティブ理由 AND 発生日時
 */
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema } from '../../shared/ids'

export const AccountInactivatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('AccountInactivated'),
  accountId: AccountIdSchema,
  reason: z.string().min(1),
})
export type AccountInactivated = z.infer<typeof AccountInactivatedSchema>
