import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { ExpenseTypeDeletionRequestIdSchema } from '../../shared/ids'

/**
 * 経費種別削除リマップ: 経費精算完了通知（08h §2「経費精算完了通知」）。
 *
 * 経費種別削除リマップ要請を受け、対象経費種別の取引を移動先へ付け替え終えたことを
 * マスタ管理のコーディネーターへ知らせる。occurredAt を完了日時として扱う。
 */
export const ExpenseTypeTransactionsRemappedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseTypeTransactionsRemapped'),
  expenseTypeDeletionRequestId: ExpenseTypeDeletionRequestIdSchema,
  affectedTransactionCount: z.number().int().nonnegative(),
})
export type ExpenseTypeTransactionsRemapped = z.infer<typeof ExpenseTypeTransactionsRemappedSchema>
