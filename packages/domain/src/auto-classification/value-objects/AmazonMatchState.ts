/**
 * Amazon 突合状態（取引取込の突合結果を受けて自動分類が判定する）
 * @see docs/domain/08b-ul-自動分類学習.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 *
 * kawasima: data Amazon突合状態 = 突合済み OR Amazon待ち OR SMBC待ち OR 突合タイムアウト確定
 *
 * タイムアウト期限 = 双方向 3 日。SMBC 先着タイムアウトは「Amazon 注文不明」で未分類確定（V-2）、
 * Amazon 先着タイムアウトは注文情報を破棄する（配送キャンセル可能性）。
 */
import { z } from 'zod'
import { TransactionIdSchema, AmazonOrderIdSchema } from '../../shared/ids'

export const AmazonMatchStateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('matched'),
    transactionId: TransactionIdSchema,
    matchedAt: z.date(),
  }),
  z.object({
    kind: z.literal('awaiting_amazon'),
    transactionId: TransactionIdSchema,
    smbcNoticeArrivedAt: z.date(),
    timeoutAt: z.date(),
  }),
  z.object({
    kind: z.literal('awaiting_smbc'),
    amazonOrderId: AmazonOrderIdSchema,
    amazonArrivedAt: z.date(),
    timeoutAt: z.date(),
  }),
  z.object({
    kind: z.literal('timeout_confirmed'),
    transactionId: TransactionIdSchema,
    timedOutAt: z.date(),
  }),
])
export type AmazonMatchState = z.infer<typeof AmazonMatchStateSchema>
