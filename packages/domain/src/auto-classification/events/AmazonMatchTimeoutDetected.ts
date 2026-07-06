import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { TransactionIdSchema, AmazonOrderIdSchema } from '../../shared/ids'

/**
 * Amazon突合タイムアウトが検知されたイベント（08b §3）
 *
 * kawasima: data Amazon突合タイムアウトが検知されたイベント = 取引ID OR Amazon注文ID AND 発生日時
 * SMBC 先着タイムアウト → transaction（V-2 未分類確定）、Amazon 先着タイムアウト → amazon_order（注文情報破棄）。
 */
export const AmazonMatchTimeoutSubjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('transaction'), transactionId: TransactionIdSchema }),
  z.object({ kind: z.literal('amazon_order'), amazonOrderId: AmazonOrderIdSchema }),
])
export type AmazonMatchTimeoutSubject = z.infer<typeof AmazonMatchTimeoutSubjectSchema>

export const AmazonMatchTimeoutDetectedSchema = DomainEventBaseSchema.extend({
  type: z.literal('AmazonMatchTimeoutDetected'),
  subject: AmazonMatchTimeoutSubjectSchema,
})
export type AmazonMatchTimeoutDetected = z.infer<typeof AmazonMatchTimeoutDetectedSchema>
