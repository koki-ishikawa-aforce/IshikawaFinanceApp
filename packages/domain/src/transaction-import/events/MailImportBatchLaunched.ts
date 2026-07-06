import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { ImportBatchIdSchema, UserIdSchema } from '../../shared/ids'

/**
 * 日次メール取込バッチ起動イベント（08a §3）
 * 08a の「日次メール取込バッチ起動」と「バッチ起動」は同一事象のため 1 イベントに統合。
 */
export const MailImportBatchLaunchedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MailImportBatchLaunched'),
  importBatchId: ImportBatchIdSchema,
  userId: UserIdSchema,
  launchedAt: z.date(),
})
export type MailImportBatchLaunched = z.infer<typeof MailImportBatchLaunchedSchema>
