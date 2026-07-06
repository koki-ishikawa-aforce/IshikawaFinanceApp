import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { ImportBatchIdSchema } from '../../shared/ids'

/** バッチ完了イベント（08a §3） */
export const MailImportBatchCompletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MailImportBatchCompleted'),
  importBatchId: ImportBatchIdSchema,
  importedCount: z.number().int().nonnegative(),
  duplicateExcludedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
})
export type MailImportBatchCompleted = z.infer<typeof MailImportBatchCompletedSchema>
