/**
 * 別銀行貯蓄残高の手入力記録（残高・資産推移管理コンテキスト、#459）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 *
 * kawasima:
 *   data 取り崩し手入力 = 入力者ユーザーID AND 取り崩し金額 AND 入力日時 AND メモ?
 *   data 残高補正手入力 = 入力者ユーザーID AND 補正前金額 AND 補正後金額 AND 入力日時 AND メモ?
 *
 * 08d §1 の `シャドウ口座更新` のうち手入力由来の 2 種。判別子は更新由来
 * （`OtherSavingsUpdateSource`）の手入力 2 値と同じ語を使い、残高更新イベントの
 * `source` と口座に積む記録とで別々の語彙にならないようにする。
 *
 * 振込由来の 2 種（SMBCからの振込加算 / SMBCへの振込減算）はここには含めない。
 * それらは取引 1 件と 1 対 1 で、口座側に持たなくても取引から辿れるためで、
 * 手入力（取引を持たず、残高の数字以外に痕跡が残らない）とは事情が異なる。
 */
import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

/**
 * 手入力に添えるメモ。空文字は「書いていない」と区別が付かないため許さず、
 * 未記入は項目ごと省く。上限は口座 payload に恒久的に積み上がる自由入力のため
 * 非アクティブ理由（100）より広めに置きつつ有限にする。
 */
export const ManualEntryMemoSchema = z.string().min(1).max(200)

export const OtherSavingsManualEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('manual_withdrawal'),
    enteredByUserId: UserIdSchema,
    /** 取り崩した金額（正の値。減算であることは種別が表す） */
    amount: MoneySchema,
    enteredAt: z.date(),
    memo: ManualEntryMemoSchema.optional(),
  }),
  z.object({
    kind: z.literal('manual_correction'),
    enteredByUserId: UserIdSchema,
    /** 補正前の現在残高。差分ではなく前後の値を残す（08d §1）*/
    balanceBefore: MoneySchema,
    balanceAfter: MoneySchema,
    enteredAt: z.date(),
    memo: ManualEntryMemoSchema.optional(),
  }),
])
export type OtherSavingsManualEntry = z.infer<typeof OtherSavingsManualEntrySchema>
