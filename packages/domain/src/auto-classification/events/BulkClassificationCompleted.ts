import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { BulkClassificationSessionIdSchema } from '../../shared/ids'

/** 一括分類完了イベント（08b §3、N-1） */
export const BulkClassificationCompletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('BulkClassificationCompleted'),
  bulkClassificationSessionId: BulkClassificationSessionIdSchema,
  processedCount: z.number().int().nonnegative(),
})
export type BulkClassificationCompleted = z.infer<typeof BulkClassificationCompletedSchema>
