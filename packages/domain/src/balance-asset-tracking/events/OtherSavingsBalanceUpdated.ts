/**
 * 別銀行貯蓄残高更新イベント（08d §3）
 * data 別銀行貯蓄残高更新イベント = 口座ID AND 変動金額 AND 変動後残高 AND 更新由来 AND 発生日時
 *
 * SMBC 銀行口座の残高更新（AccountBalanceUpdated）とは別イベントにする。
 * 別銀行貯蓄はメール由来の自動更新が無く手入力・振込由来のみで動くため、
 * 購読側が「どの由来で動いたか」を見分けられる必要がある（08d §3 の更新由来）。
 */
import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { AccountIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { OtherSavingsUpdateSourceSchema } from '../value-objects/OtherSavingsUpdateSource'

export const OtherSavingsBalanceUpdatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('OtherSavingsBalanceUpdated'),
  accountId: AccountIdSchema,
  delta: MoneySchema,
  newBalance: MoneySchema,
  source: OtherSavingsUpdateSourceSchema,
})
export type OtherSavingsBalanceUpdated = z.infer<typeof OtherSavingsBalanceUpdatedSchema>
