/**
 * 遡及候補リスト（J-3: 過去未分類への遡及提案）
 * @see docs/domain/08b-ul-自動分類学習.md §2
 *
 * kawasima: data 遡及候補リスト = ユーザーID AND List<取引ID> AND 提案日時
 *
 * 対象は当該ユーザーの未分類取引のみ（既分類・配偶者取引は触らない、F-1）。
 */
import { z } from 'zod'
import { UserIdSchema, TransactionIdSchema } from '../../shared/ids'

export const RetroactiveClassificationProposalSchema = z.object({
  userId: UserIdSchema,
  transactionIds: z.array(TransactionIdSchema),
  proposedAt: z.date(),
})
export type RetroactiveClassificationProposal = z.infer<
  typeof RetroactiveClassificationProposalSchema
>
