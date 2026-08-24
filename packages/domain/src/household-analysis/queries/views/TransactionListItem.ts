import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { ExpenseClassSchema } from '../../../shared/value-objects/ExpenseClass'
import { TransactionIdSchema, CategoryIdSchema } from '../../../shared/ids'

/**
 * 取引一覧の 1 行。プライバシー 3 段階適用済み。
 *
 * 相手に見せてはいけない取引は **行ごと除外**する(伏せ字行として残さない)。
 * 判定は `applyPrivacyFilter` の `isListVisible` に集約されている:
 * - 世帯: 双方に掲載
 * - 個人(夫 / 妻)・経費(会社)・未分類: 所有者本人のみ掲載(相手のリストには載らない)
 * - 削除済み: 常に除外
 *
 * したがって、ここを通過した行の merchantName / amount は常に可視で、`toListItems` は
 * null を入れない(集約側も `merchantName` / `amount` は非 null)。
 * スキーマが nullable なのは伏せ字行を返していた頃の名残であり、
 * 「配偶者の個人取引を伏せ字で返す」という現在の契約ではない
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
