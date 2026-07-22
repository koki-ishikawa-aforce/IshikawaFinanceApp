import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { ExpenseClassSchema } from '../../../shared/value-objects/ExpenseClass'
import { TransactionIdSchema, CategoryIdSchema } from '../../../shared/ids'

/**
 * 取引一覧の 1 行。プライバシー 3 段階適用済み（OQ-47: Query/API 層で完全強制）。
 * - 配偶者の個人取引・経費(会社)取引はリスト自体から完全除外（伏せ字行は残さない）
 * - 未分類取引は所有者本人のみリスト掲載
 * - 掲載される行は常に明細フル表示。merchantName / amount が nullable なのは
 *   ワイヤー互換のための構造上の許容であり、返却行では常に値が入る
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
