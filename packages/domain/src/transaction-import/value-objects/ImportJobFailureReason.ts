/**
 * 明細取込ジョブ失敗理由
 * @see docs/domain/08a-ul-取引取込.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 */
import { z } from 'zod'
import { PdfConversionFailureReasonSchema } from './PdfConversionResult'

export const ImportJobFailureReasonSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pdf_conversion_failed'),
    /** 構造化された PDF 変換失敗理由（08a: `data PDF変換失敗 = 変換失敗理由 AND 失敗詳細 AND 検知日時`） */
    reason: PdfConversionFailureReasonSchema,
    failureDetail: z.string().min(1),
    detectedAt: z.date(),
  }),
  z.object({
    kind: z.literal('format_validation_failed'),
    failureDetail: z.string().min(1),
    detectedAt: z.date(),
  }),
  z.object({
    kind: z.literal('import_error'),
    failureDetail: z.string().min(1),
    detectedAt: z.date(),
  }),
])
export type ImportJobFailureReason = z.infer<typeof ImportJobFailureReasonSchema>
