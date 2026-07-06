/**
 * 分類結果（取引候補ルックアップの出力）
 * @see docs/domain/08b-ul-自動分類学習.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 *
 * kawasima: data 分類結果 = 自動分類済み取引 OR 未分類取引
 *
 * 不変条件:
 *  - 経費(会社) の場合のみ 適用済み経費種別ID を持つ（? は業務上適用されない場合のみ許容）
 *  - M-1: 学習無効化適用時は 未分類取引（reason = learning_disabled）として下流に渡す
 */
import { z } from 'zod'
import { TransactionIdSchema, CategoryIdSchema, ExpenseTypeIdSchema } from '../../shared/ids'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'
import { ClassificationBasisSchema } from '../../shared/value-objects/ClassificationBasis'
import { UnclassifiedReasonSchema } from '../../shared/value-objects/UnclassifiedReason'
import { DefaultExpenseClassSchema } from '../../shared/value-objects/PersonalExpenseClass'

/** 未分類取引（一括分類セッションの対象としても再利用する） */
export const BulkClassificationTargetSchema = z.object({
  kind: z.literal('unclassified'),
  transactionId: TransactionIdSchema,
  merchantName: z.string().min(1),
  reason: UnclassifiedReasonSchema,
  defaultExpenseClass: DefaultExpenseClassSchema,
})
export type BulkClassificationTarget = z.infer<typeof BulkClassificationTargetSchema>

export const ClassificationResultSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('auto_classified'),
      transactionId: TransactionIdSchema,
      merchantName: z.string().min(1),
      categoryId: CategoryIdSchema,
      expenseClass: ExpenseClassSchema,
      appliedExpenseTypeId: ExpenseTypeIdSchema.optional(),
      basis: ClassificationBasisSchema,
    }),
    BulkClassificationTargetSchema,
  ])
  .superRefine((result, ctx) => {
    if (result.kind !== 'auto_classified') return
    if (result.expenseClass === 'business_expense' && result.appliedExpenseTypeId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '経費(会社) の自動分類済み取引は appliedExpenseTypeId が必須',
        path: ['appliedExpenseTypeId'],
      })
    }
    if (result.expenseClass !== 'business_expense' && result.appliedExpenseTypeId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '経費(会社) 以外の自動分類済み取引は appliedExpenseTypeId を持てない',
        path: ['appliedExpenseTypeId'],
      })
    }
  })
export type ClassificationResult = z.infer<typeof ClassificationResultSchema>

export type AutoClassifiedResult = Extract<ClassificationResult, { kind: 'auto_classified' }>
export type UnclassifiedResult = Extract<ClassificationResult, { kind: 'unclassified' }>
