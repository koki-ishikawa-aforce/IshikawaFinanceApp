import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { ImportJobIdSchema, UserIdSchema } from '../../shared/ids'
import { ImportResultSummarySchema } from '../value-objects/ImportResultSummary'

/** CSV取込完了イベント（08a §3。通知配信のリマインダー停止判定にも使われる） */
export const CsvImportCompletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('CsvImportCompleted'),
  importJobId: ImportJobIdSchema,
  userId: UserIdSchema,
  summary: ImportResultSummarySchema,
})
export type CsvImportCompleted = z.infer<typeof CsvImportCompletedSchema>
