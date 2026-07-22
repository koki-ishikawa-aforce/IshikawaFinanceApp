/**
 * 証券会社名変更イベント（08d §2、Phase 3.5）
 * data 証券会社名変更イベント = 口座ID AND 旧証券会社名 AND 新証券会社名 AND 変更者ユーザーID AND 変更日時 AND 発生日時
 */
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema, UserIdSchema } from '../../shared/ids'
import { BrokerageNameSchema } from '../value-objects/BrokerageName'

export const BrokerageNameChangedSchema = DomainEventBaseSchema.extend({
  type: z.literal('BrokerageNameChanged'),
  accountId: AccountIdSchema,
  oldBrokerageName: BrokerageNameSchema,
  newBrokerageName: BrokerageNameSchema,
  changedByUserId: UserIdSchema,
  changedAt: z.date(),
})
export type BrokerageNameChanged = z.infer<typeof BrokerageNameChangedSchema>
