import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { PdfConversionJobIdSchema, ImportJobIdSchema } from '../../shared/ids'
import { PdfConversionFailureReasonSchema } from '../value-objects/PdfConversionResult'

/** PDF変換失敗イベント（08a §3） */
export const PdfConversionFailedSchema = DomainEventBaseSchema.extend({
  type: z.literal('PdfConversionFailed'),
  pdfConversionJobId: PdfConversionJobIdSchema,
  importJobId: ImportJobIdSchema,
  reason: PdfConversionFailureReasonSchema,
})
export type PdfConversionFailed = z.infer<typeof PdfConversionFailedSchema>
