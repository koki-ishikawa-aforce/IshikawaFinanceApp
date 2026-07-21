/**
 * PDF 変換結果（PDF → CSV 変換、Anthropic API 利用は adapter 層関心）
 * @see docs/domain/08a-ul-取引取込.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 *
 * 変換の検証は行数一致 + 合計金額一致で行う（OQ-23）。
 * 検証失敗はそれぞれ row_count_mismatch / total_amount_mismatch として区別する。
 */
import { z } from 'zod'
import { PdfConversionJobIdSchema, UploadFileIdSchema } from '../../shared/ids'

export const PdfConversionFailureReasonSchema = z.enum([
  'api_call_failed',
  'invalid_response_structure',
  'row_count_mismatch',
  'total_amount_mismatch',
  'timeout',
])
export type PdfConversionFailureReason = z.infer<typeof PdfConversionFailureReasonSchema>

export const PdfConversionResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('success'),
    pdfConversionJobId: PdfConversionJobIdSchema,
    generatedCsvFileId: UploadFileIdSchema,
    completedAt: z.date(),
  }),
  z.object({
    kind: z.literal('failure'),
    pdfConversionJobId: PdfConversionJobIdSchema,
    reason: PdfConversionFailureReasonSchema,
    detectedAt: z.date(),
  }),
])
export type PdfConversionResult = z.infer<typeof PdfConversionResultSchema>
