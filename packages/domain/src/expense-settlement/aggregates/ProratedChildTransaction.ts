/**
 * 按分子取引集約（経費精算コンテキスト）
 * @see docs/domain/08e-ul-経費精算.md §1
 * @see docs/domain/09-aggregates.md #12
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.2
 *
 * kawasima: data 按分根拠 = 上限超過先着按分 OR 経費修正再按分 OR 経費削除再按分
 *
 * 不変条件:
 *  - 個人充当金額 > 0 でなければ生成されない
 *  - 親取引IDが必ず存在する（孤立した按分子取引は不可、必須フィールドで構造表現）
 *  - 按分根拠が必ず設定される
 */
import { z } from 'zod'
import {
  ChildTransactionIdSchema,
  TransactionIdSchema,
  UserIdSchema,
  MonthlyExpenseCycleIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { PersonalExpenseClassSchema } from '../../shared/value-objects/PersonalExpenseClass'

export const ProrationBasisSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cap_excess_fifo'),
    monthlyExpenseCycleId: MonthlyExpenseCycleIdSchema,
    proratedAt: z.date(),
    capRemainderAtExcess: MoneySchema,
  }),
  z.object({
    kind: z.literal('correction_recalculation'),
    monthlyExpenseCycleId: MonthlyExpenseCycleIdSchema,
    causingTransactionId: TransactionIdSchema,
    recalculatedAt: z.date(),
  }),
  z.object({
    kind: z.literal('deletion_recalculation'),
    monthlyExpenseCycleId: MonthlyExpenseCycleIdSchema,
    causingTransactionId: TransactionIdSchema,
    recalculatedAt: z.date(),
  }),
])
export type ProrationBasis = z.infer<typeof ProrationBasisSchema>

export const ProratedChildTransactionSchema = z
  .object({
    childTransactionId: ChildTransactionIdSchema,
    parentTransactionId: TransactionIdSchema,
    userId: UserIdSchema,
    personalAmount: MoneySchema,
    personalExpenseClass: PersonalExpenseClassSchema,
    derivedAt: z.date(),
    prorationBasis: ProrationBasisSchema,
  })
  .superRefine((child, ctx) => {
    if (child.personalAmount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '個人充当金額は 0 より大きい必要がある',
        path: ['personalAmount'],
      })
    }
  })
export type ProratedChildTransaction = z.infer<typeof ProratedChildTransactionSchema>
