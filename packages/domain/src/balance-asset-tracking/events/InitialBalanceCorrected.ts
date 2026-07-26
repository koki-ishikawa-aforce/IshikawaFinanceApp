/**
 * 初期残高修正イベント（08d §3）
 * data 初期残高修正イベント = 口座ID AND 旧初期残高 AND 新初期残高 AND 修正者ユーザーID AND 発生日時
 *
 * 初期残高は現在残高の起点（現在残高 = 初期残高 + 以降の変動）のため、
 * 修正は現在残高も同額ずらす。購読側は差分（新 − 旧）で現在残高の変化量を導ける。
 */
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema, UserIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

export const InitialBalanceCorrectedSchema = DomainEventBaseSchema.extend({
  type: z.literal('InitialBalanceCorrected'),
  accountId: AccountIdSchema,
  oldInitialBalance: MoneySchema,
  newInitialBalance: MoneySchema,
  correctedByUserId: UserIdSchema,
})
export type InitialBalanceCorrected = z.infer<typeof InitialBalanceCorrectedSchema>
