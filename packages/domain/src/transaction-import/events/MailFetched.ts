import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { ImportBatchIdSchema } from '../../shared/ids'

/** メール取得イベント（08a §3） */
export const MailFetchedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MailFetched'),
  importBatchId: ImportBatchIdSchema,
  fetchedCount: z.number().int().nonnegative(),
})
export type MailFetched = z.infer<typeof MailFetchedSchema>
