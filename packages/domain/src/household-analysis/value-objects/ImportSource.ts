/**
 * 取込ソース（取引がどこから取り込まれたか）
 * @see docs/domain/08c-ul-家計分析.md §1
 *
 * kawasima: data 取込ソース = メール由来 OR CSV由来 OR PDF由来 OR Amazon突合由来 OR 手動入力由来 OR CSV手動マージ由来
 */
import { z } from 'zod'
import { GmailMessageIdSchema, UserIdSchema, TransactionIdSchema } from '../../shared/ids'

export const ImportSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('email'),
    gmailMessageId: GmailMessageIdSchema,
  }),
  z.object({
    kind: z.literal('csv'),
    csvFileId: z.string().min(1),
    rowNumber: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('pdf'),
    pdfFileId: z.string().min(1),
    pageNumber: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('amazon_match'),
    smbcGmailMessageId: GmailMessageIdSchema,
    amazonOrderId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('manual'),
    enteredAt: z.date(),
    enteredByUserId: UserIdSchema,
  }),
  z.object({
    kind: z.literal('csv_merge'),
    originalTransactionId: TransactionIdSchema,
    mergedAt: z.date(),
  }),
])
export type ImportSource = z.infer<typeof ImportSourceSchema>
