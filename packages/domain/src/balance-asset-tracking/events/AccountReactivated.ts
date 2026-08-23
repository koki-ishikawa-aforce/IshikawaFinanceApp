/**
 * 口座再アクティブ化イベント（08d §3。#457）
 * data 口座再アクティブ化イベント = 口座ID AND 解除前の非アクティブ理由 AND 発生日時
 *
 * 解除前の非アクティブ理由を載せるのは、口座側の記録（非アクティブ化日時・理由）が
 * 再アクティブ化で消えるため。「いつ・なぜ閉じたか」はイベントの側に残す。
 */
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema } from '../../shared/ids'

export const AccountReactivatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('AccountReactivated'),
  accountId: AccountIdSchema,
  clearedInactivationReason: z.string().min(1),
})
export type AccountReactivated = z.infer<typeof AccountReactivatedSchema>
