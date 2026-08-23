/**
 * 口座再アクティブ化イベント（08d §3。#457）
 * data 口座再アクティブ化イベント = 口座ID AND 解除前の非アクティブ理由 AND 発生日時
 *
 * 解除前の非アクティブ理由を載せるのは、口座側の記録（非アクティブ化日時・理由）が
 * 再アクティブ化で消えるため。ただし現時点でこのイベントの購読者もイベントストアも
 * 無く、発行しても永続化はされない（後から「いつ・なぜ閉じたか」を引くには、
 * イベントを保存する仕組みが別途要る）。
 */
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema } from '../../shared/ids'
import { InactivationReasonSchema } from '../value-objects/InactivationReason'

export const AccountReactivatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('AccountReactivated'),
  accountId: AccountIdSchema,
  clearedInactivationReason: InactivationReasonSchema,
})
export type AccountReactivated = z.infer<typeof AccountReactivatedSchema>
