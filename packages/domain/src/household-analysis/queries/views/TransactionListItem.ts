import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { ExpenseClassSchema } from '../../../shared/value-objects/ExpenseClass'
import { TransactionIdSchema, CategoryIdSchema } from '../../../shared/ids'

/**
 * 取引一覧の 1 行。プライバシー 3 段階適用済み。
 * - 配偶者の個人取引は merchantName / amount を null
 * - 経費(会社) で他人の取引はリスト自体から除外
 * - 未分類取引は所有者本人のみリスト掲載
 */
export const TransactionListItemSchema = z.object({
  transactionId: TransactionIdSchema,
  occurredAt: z.date(),
  expenseClass: ExpenseClassSchema,
  categoryId: CategoryIdSchema.nullable(),
  categoryName: z.string().nullable(),
  merchantName: z.string().nullable(),
  amount: MoneySchema.nullable(),
  isUnclassified: z.boolean(),
})
export type TransactionListItem = z.infer<typeof TransactionListItemSchema>
