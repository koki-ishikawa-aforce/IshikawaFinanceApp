/**
 * 口座非アクティブ化イベント（08d §3）
 * data 口座非アクティブ化イベント = 口座ID AND 非アクティブ理由 AND 発生日時
 */
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema } from '../../shared/ids'
import { InactivationReasonSchema } from '../value-objects/InactivationReason'

export const AccountInactivatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('AccountInactivated'),
  accountId: AccountIdSchema,
  reason: InactivationReasonSchema,
})
export type AccountInactivated = z.infer<typeof AccountInactivatedSchema>
