/**
 * 取込ソース（取引がどこから取り込まれたか）
 * @see docs/domain/08a-ul-取引取込.md §1
 * @see docs/domain/08c-ul-家計分析.md §1
 *
 * kawasima: data 取込ソース = メール由来 OR CSV由来 OR PDF由来 OR Amazon突合由来 OR 手動入力由来 OR CSV手動マージ由来
 *
 * 取引取込（取引候補の生成側）と家計分析（取引の保持側）の共有カーネル語彙。
 * Phase 5 M-A で household-analysis から shared へ移設し、メンバー schema を個別 export
 * （取引取込側は csv_merge を除く 5 種で CandidateImportSource を再構成する）。
 * `csvFileId` / `pdfFileId` / `amazonOrderId` は branded 型へ強化（エクスポート名は不変）。
 * pdf の `pdfConversionJobId` は取引取込での生成時には必須だが、家計分析の既存行では
 * 未設定を許容するため optional。
 */
import { z } from 'zod'
import {
  GmailMessageIdSchema,
  UserIdSchema,
  TransactionIdSchema,
  UploadFileIdSchema,
  PdfConversionJobIdSchema,
  AmazonOrderIdSchema,
} from '../ids'

export const ImportSourceEmailSchema = z.object({
  kind: z.literal('email'),
  gmailMessageId: GmailMessageIdSchema,
})

export const ImportSourceCsvSchema = z.object({
  kind: z.literal('csv'),
  csvFileId: UploadFileIdSchema,
  rowNumber: z.number().int().nonnegative(),
})

export const ImportSourcePdfSchema = z.object({
  kind: z.literal('pdf'),
  pdfFileId: UploadFileIdSchema,
  pageNumber: z.number().int().positive(),
  pdfConversionJobId: PdfConversionJobIdSchema.optional(),
})

export const ImportSourceAmazonMatchSchema = z.object({
  kind: z.literal('amazon_match'),
  smbcGmailMessageId: GmailMessageIdSchema,
  amazonOrderId: AmazonOrderIdSchema,
})

export const ImportSourceManualSchema = z.object({
  kind: z.literal('manual'),
  enteredAt: z.date(),
  enteredByUserId: UserIdSchema,
})

export const ImportSourceCsvMergeSchema = z.object({
  kind: z.literal('csv_merge'),
  originalTransactionId: TransactionIdSchema,
  mergedAt: z.date(),
})

export const ImportSourceSchema = z.discriminatedUnion('kind', [
  ImportSourceEmailSchema,
  ImportSourceCsvSchema,
  ImportSourcePdfSchema,
  ImportSourceAmazonMatchSchema,
  ImportSourceManualSchema,
  ImportSourceCsvMergeSchema,
])
export type ImportSource = z.infer<typeof ImportSourceSchema>
