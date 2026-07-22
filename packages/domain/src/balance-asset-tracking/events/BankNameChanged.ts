/**
 * 銀行名変更イベント（08d §2、Phase 3.5）
 * data 銀行名変更イベント = 口座ID AND 旧銀行名 AND 新銀行名 AND 変更者ユーザーID AND 変更日時 AND 発生日時
 */
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema, UserIdSchema } from '../../shared/ids'
import { BankNameSchema } from '../value-objects/BankName'

export const BankNameChangedSchema = DomainEventBaseSchema.extend({
  type: z.literal('BankNameChanged'),
  accountId: AccountIdSchema,
  oldBankName: BankNameSchema,
  newBankName: BankNameSchema,
  changedByUserId: UserIdSchema,
  changedAt: z.date(),
})
export type BankNameChanged = z.infer<typeof BankNameChangedSchema>
