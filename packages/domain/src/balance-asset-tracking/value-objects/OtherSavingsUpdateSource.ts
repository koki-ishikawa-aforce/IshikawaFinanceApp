/**
 * 別銀行貯蓄残高の更新由来（残高・資産推移管理コンテキスト）
 * @see docs/domain/08d-ul-残高資産推移管理.md §3
 *
 * kawasima: data 更新由来 = SMBC振込加算由来 OR SMBC振込減算由来 OR 取り崩し手入力由来 OR 残高補正手入力由来
 *
 * 各値を生む振る舞い（08d §2）:
 *  - smbc_transfer_addition: 別銀行貯蓄残高をSMBC振込で加算する（出金用途 = 別銀行振込用）
 *  - smbc_transfer_subtraction: 別銀行戻し判別で貯蓄口座から SMBC へ戻したときの減算。
 *    生成元は銀行入金の用途判別（#390）で、本コンテキストの手動操作からは発生しない
 *  - manual_withdrawal: 別銀行貯蓄残高を取り崩しで減算する
 *  - manual_correction: 別銀行貯蓄残高を手動補正する
 */
import { z } from 'zod'

export const OtherSavingsUpdateSourceSchema = z.enum([
  'smbc_transfer_addition',
  'smbc_transfer_subtraction',
  'manual_withdrawal',
  'manual_correction',
])
export type OtherSavingsUpdateSource = z.infer<typeof OtherSavingsUpdateSourceSchema>
