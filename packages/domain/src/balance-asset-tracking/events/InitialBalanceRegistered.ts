/**
 * 初期残高登録イベント（08d §3）
 * data 初期残高登録イベント = ユーザーID AND 口座ID AND 初期残高 AND 発生日時
 *
 * 口座登録（registerOtherSavingsAccount / registerNisaAccount）は UL の
 * 「口座をアプリに登録する」と「初期残高を登録する」を 1 アクションに統合しており、
 * 登録時は AccountRegistered と本イベントを併発する。
 */
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema, UserIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const InitialBalanceRegisteredSchema = DomainEventBaseSchema.extend({
  type: z.literal('InitialBalanceRegistered'),
  userId: UserIdSchema,
  accountId: AccountIdSchema,
  initialBalance: MoneySchema,
})
export type InitialBalanceRegistered = z.infer<typeof InitialBalanceRegisteredSchema>
