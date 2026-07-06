/**
 * 月次上限集約（マスタ管理コンテキスト）
 * @see docs/domain/08h-ul-マスタ管理.md §1
 * @see docs/domain/09-aggregates.md #20
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.5
 *
 * kawasima: data 月次上限 = 上限あり月次上限 OR 無制限月次上限
 *
 * 不変条件:
 *  - ユーザーID + 経費種別ID で一意（Repository.findByUserAndExpenseType で保証、Phase 5 M-B）
 *  - 論点15: 「上限あり」と「無制限」は OR で完全分離。無制限は上限金額を構造的に持たない
 *    （`.strict()` で余剰キーを拒否、マジックナンバー不使用）
 */
import { z } from 'zod'
import { MonthlyLimitIdSchema, UserIdSchema, ExpenseTypeIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'

/** 上限変更履歴レコード */
export const LimitChangeRecordSchema = z.object({
  oldCapAmount: MoneySchema,
  newCapAmount: MoneySchema,
  changedAt: z.date(),
  changedByUserId: UserIdSchema,
  changeReason: z.string().optional(),
})
export type LimitChangeRecord = z.infer<typeof LimitChangeRecordSchema>

export const MonthlyLimitSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('capped'),
    monthlyLimitId: MonthlyLimitIdSchema,
    userId: UserIdSchema,
    expenseTypeId: ExpenseTypeIdSchema,
    effectiveFrom: z.date(),
    capAmount: MoneySchema,
    changeHistory: z.array(LimitChangeRecordSchema),
  }),
  z
    .object({
      kind: z.literal('unlimited'),
      monthlyLimitId: MonthlyLimitIdSchema,
      userId: UserIdSchema,
      expenseTypeId: ExpenseTypeIdSchema,
      effectiveFrom: z.date(),
    })
    .strict(),
])
export type MonthlyLimit = z.infer<typeof MonthlyLimitSchema>

export type CappedMonthlyLimit = Extract<MonthlyLimit, { kind: 'capped' }>
export type UnlimitedMonthlyLimit = Extract<MonthlyLimit, { kind: 'unlimited' }>
