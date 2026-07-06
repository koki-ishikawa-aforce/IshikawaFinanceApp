/**
 * 経費判定結果（自動分類の経費種別軸の出力を経費精算視点で受ける語彙）
 * @see docs/domain/08e-ul-経費精算.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.2
 *
 * kawasima: data 経費判定結果 = 経費種別判定済み OR 経費種別未判定 OR 経費判定不能
 *
 * 理由は shared の UnclassifiedReason のサブセット（`.extract()` で導出し、
 * shared 側の改名・削除をコンパイルエラーで検知する）。
 */
import { z } from 'zod'
import { TransactionIdSchema, ExpenseTypeIdSchema } from '../../shared/ids'
import { ClassificationBasisSchema } from '../../shared/value-objects/ClassificationBasis'
import { UnclassifiedReasonSchema } from '../../shared/value-objects/UnclassifiedReason'

export const ExpenseJudgmentPendingReasonSchema = UnclassifiedReasonSchema.extract([
  'merchant_rule_unlearned',
  'amazon_product_key_unlearned',
])
export type ExpenseJudgmentPendingReason = z.infer<typeof ExpenseJudgmentPendingReasonSchema>

export const ExpenseJudgmentUndecidableReasonSchema = UnclassifiedReasonSchema.extract([
  'amazon_product_info_undecidable',
  'amazon_match_timeout',
])
export type ExpenseJudgmentUndecidableReason = z.infer<
  typeof ExpenseJudgmentUndecidableReasonSchema
>

export const ExpenseJudgmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('judged'),
    transactionId: TransactionIdSchema,
    expenseTypeId: ExpenseTypeIdSchema,
    basis: ClassificationBasisSchema,
  }),
  z.object({
    kind: z.literal('unjudged'),
    transactionId: TransactionIdSchema,
    reason: ExpenseJudgmentPendingReasonSchema,
  }),
  z.object({
    kind: z.literal('undecidable'),
    transactionId: TransactionIdSchema,
    reason: ExpenseJudgmentUndecidableReasonSchema,
  }),
])
export type ExpenseJudgment = z.infer<typeof ExpenseJudgmentSchema>
