import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { PdfConversionJobIdSchema, ImportJobIdSchema } from '../../shared/ids'

/** PDF変換完了イベント（08a §3） */
export const PdfConversionCompletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('PdfConversionCompleted'),
  pdfConversionJobId: PdfConversionJobIdSchema,
  importJobId: ImportJobIdSchema,
})
export type PdfConversionCompleted = z.infer<typeof PdfConversionCompletedSchema>
