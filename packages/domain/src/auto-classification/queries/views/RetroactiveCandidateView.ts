/**
 * 遡及候補 View（J-3 確認ダイアログの表示データ）
 * @see docs/domain/08b-ul-自動分類学習.md §2
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 */
import { z } from 'zod'
import { UserIdSchema, TransactionIdSchema } from '../../../shared/ids'
import { MoneySchema } from '../../../shared/value-objects/Money'

export const RetroactiveCandidateItemSchema = z.object({
  transactionId: TransactionIdSchema,
  occurredAt: z.date(),
  amount: MoneySchema,
})
export type RetroactiveCandidateItem = z.infer<typeof RetroactiveCandidateItemSchema>

export const RetroactiveCandidateViewSchema = z.object({
  userId: UserIdSchema,
  merchantName: z.string().min(1),
  candidates: z.array(RetroactiveCandidateItemSchema),
  proposedAt: z.date(),
})
export type RetroactiveCandidateView = z.infer<typeof RetroactiveCandidateViewSchema>
