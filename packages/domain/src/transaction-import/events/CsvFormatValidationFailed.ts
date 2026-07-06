import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { ImportJobIdSchema } from '../../shared/ids'

/** CSVフォーマット検証失敗イベント（08a §3） */
export const CsvFormatValidationFailedSchema = DomainEventBaseSchema.extend({
  type: z.literal('CsvFormatValidationFailed'),
  importJobId: ImportJobIdSchema,
  failureDetail: z.string().min(1),
})
export type CsvFormatValidationFailed = z.infer<typeof CsvFormatValidationFailedSchema>
