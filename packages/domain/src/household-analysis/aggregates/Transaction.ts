/**
 * 取引集約（家計分析コンテキスト）
 * @see docs/domain/08c-ul-家計分析.md §1
 * @see docs/domain/09-aggregates.md #7
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.1
 *
 * kawasima: data 取引 = 未分類取引 OR 分類済み取引 OR 削除済み取引
 *
 * 不変条件:
 *  - 経費(会社) 取引は経費種別ID 必須
 *  - 削除済み取引は変更不可（型遷移として表現、deleted → 他状態への関数を提供しない）
 */
import { z } from 'zod'
import {
  TransactionIdSchema,
  UserIdSchema,
  CategoryIdSchema,
  ExpenseTypeIdSchema,
} from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'
import { ImportSourceSchema } from '../../shared/value-objects/ImportSource'
import { ClassificationBasisSchema } from '../../shared/value-objects/ClassificationBasis'
import { UnclassifiedReasonSchema } from '../../shared/value-objects/UnclassifiedReason'
import { DefaultExpenseClassSchema } from '../../shared/value-objects/PersonalExpenseClass'

/** 共通取引属性 */
export const CommonTransactionAttrsSchema = z.object({
  transactionId: TransactionIdSchema,
  ownerUserId: UserIdSchema,
  merchantName: z.string().min(1),
  amount: MoneySchema,
  occurredAt: z.date(),
  importSource: ImportSourceSchema,
})
export type CommonTransactionAttrs = z.infer<typeof CommonTransactionAttrsSchema>

/** 経費種別参照: 経費(会社)取引なら経費種別ID 必須 */
export const ExpenseTypeRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('business'), expenseTypeId: ExpenseTypeIdSchema }),
  z.object({ kind: z.literal('non_business') }),
])
export type ExpenseTypeRef = z.infer<typeof ExpenseTypeRefSchema>

/**
 * 分類済み取引固有データ。
 * 不変条件（経費(会社) ⟺ expenseTypeRef.kind = business）はここに一元化する。
 * 上位（Transaction / api・adapters の分類詳細組み立て）はこのスキーマに委譲し、再実装しない。
 */
export const ClassifiedDetailsSchema = z
  .object({
    categoryId: CategoryIdSchema,
    expenseClass: ExpenseClassSchema,
    expenseTypeRef: ExpenseTypeRefSchema,
    basis: ClassificationBasisSchema,
  })
  .superRefine((details, ctx) => {
    if (details.expenseClass === 'business_expense' && details.expenseTypeRef.kind !== 'business') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '経費(会社) 取引は expenseTypeRef.kind = business が必須',
        path: ['expenseTypeRef'],
      })
    }
    if (details.expenseClass !== 'business_expense' && details.expenseTypeRef.kind === 'business') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '経費(会社) 以外の取引は expenseTypeRef.kind = non_business である必要がある',
        path: ['expenseTypeRef'],
      })
    }
  })
export type ClassifiedDetails = z.infer<typeof ClassifiedDetailsSchema>

/** 削除理由 */
export const DeletionReasonSchema = z.enum([
  'user_deleted',
  'merge_absorbed',
  'refund_match_absorbed',
])
export type DeletionReason = z.infer<typeof DeletionReasonSchema>

/**
 * 取引（discriminated union）
 * 分類済み取引の経費種別不変条件は ClassifiedDetailsSchema に一元化済み（details 検証時に適用される）。
 */
export const TransactionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('unclassified'),
    common: CommonTransactionAttrsSchema,
    reason: UnclassifiedReasonSchema,
    defaultExpenseClass: DefaultExpenseClassSchema,
  }),
  z.object({
    kind: z.literal('classified'),
    common: CommonTransactionAttrsSchema,
    details: ClassifiedDetailsSchema,
  }),
  z.object({
    kind: z.literal('deleted'),
    common: CommonTransactionAttrsSchema,
    deletedAt: z.date(),
    deletionReason: DeletionReasonSchema,
  }),
])
export type Transaction = z.infer<typeof TransactionSchema>

export type UnclassifiedTransaction = Extract<Transaction, { kind: 'unclassified' }>
export type ClassifiedTransaction = Extract<Transaction, { kind: 'classified' }>
export type DeletedTransaction = Extract<Transaction, { kind: 'deleted' }>

/** 取引生成（不正データは ZodError を throw） */
export function createTransaction(input: unknown): Transaction {
  return TransactionSchema.parse(input)
}

/** 状態遷移: 未分類 → 分類済み */
export function classify(
  unclassified: UnclassifiedTransaction,
  details: ClassifiedDetails,
): ClassifiedTransaction {
  return TransactionSchema.parse({
    kind: 'classified',
    common: unclassified.common,
    details,
  }) as ClassifiedTransaction
}

/** 状態遷移: 未分類 or 分類済み → 削除済み */
export function deleteTransaction(
  tx: UnclassifiedTransaction | ClassifiedTransaction,
  reason: DeletionReason,
  at: Date,
): DeletedTransaction {
  return TransactionSchema.parse({
    kind: 'deleted',
    common: tx.common,
    deletedAt: at,
    deletionReason: reason,
  }) as DeletedTransaction
}
