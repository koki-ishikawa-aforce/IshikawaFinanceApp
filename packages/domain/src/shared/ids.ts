/**
 * Branded ID 型一式
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.1
 *
 * Phase 4 では永続化バックエンド未確定のため、ID 形式は最小限のチェックのみ。
 * Phase 5 で ULID 等の正規表現に強化する余地あり（OQ-41）。
 */
import { z } from 'zod'

const idSchema = z.string().min(1)

export const TransactionIdSchema = idSchema.brand<'TransactionId'>()
export type TransactionId = z.infer<typeof TransactionIdSchema>

export const UserIdSchema = idSchema.brand<'UserId'>()
export type UserId = z.infer<typeof UserIdSchema>

export const CategoryIdSchema = idSchema.brand<'CategoryId'>()
export type CategoryId = z.infer<typeof CategoryIdSchema>

export const ExpenseTypeIdSchema = idSchema.brand<'ExpenseTypeId'>()
export type ExpenseTypeId = z.infer<typeof ExpenseTypeIdSchema>

export const AccountIdSchema = idSchema.brand<'AccountId'>()
export type AccountId = z.infer<typeof AccountIdSchema>

export const MitsuiSumitomoUnpaidIdSchema = idSchema.brand<'MitsuiSumitomoUnpaidId'>()
export type MitsuiSumitomoUnpaidId = z.infer<typeof MitsuiSumitomoUnpaidIdSchema>

export const UnpaidEntryIdSchema = idSchema.brand<'UnpaidEntryId'>()
export type UnpaidEntryId = z.infer<typeof UnpaidEntryIdSchema>

export const MonthlyReportIdSchema = idSchema.brand<'MonthlyReportId'>()
export type MonthlyReportId = z.infer<typeof MonthlyReportIdSchema>

export const ExpenseReimbursementIdSchema = idSchema.brand<'ExpenseReimbursementId'>()
export type ExpenseReimbursementId = z.infer<typeof ExpenseReimbursementIdSchema>

export const SettlementNoticeIdSchema = idSchema.brand<'SettlementNoticeId'>()
export type SettlementNoticeId = z.infer<typeof SettlementNoticeIdSchema>

export const GmailMessageIdSchema = idSchema.brand<'GmailMessageId'>()
export type GmailMessageId = z.infer<typeof GmailMessageIdSchema>

// --- Phase 5 M-A: 取引取込 ---

export const TransactionCandidateIdSchema = idSchema.brand<'TransactionCandidateId'>()
export type TransactionCandidateId = z.infer<typeof TransactionCandidateIdSchema>

export const ImportBatchIdSchema = idSchema.brand<'ImportBatchId'>()
export type ImportBatchId = z.infer<typeof ImportBatchIdSchema>

export const ImportJobIdSchema = idSchema.brand<'ImportJobId'>()
export type ImportJobId = z.infer<typeof ImportJobIdSchema>

export const UploadFileIdSchema = idSchema.brand<'UploadFileId'>()
export type UploadFileId = z.infer<typeof UploadFileIdSchema>

export const PdfConversionJobIdSchema = idSchema.brand<'PdfConversionJobId'>()
export type PdfConversionJobId = z.infer<typeof PdfConversionJobIdSchema>

export const AmazonOrderIdSchema = idSchema.brand<'AmazonOrderId'>()
export type AmazonOrderId = z.infer<typeof AmazonOrderIdSchema>

// --- Phase 5 M-A: 自動分類・学習 ---
// 加盟店学習ルール / Amazon商品キー学習ルールは自然キー（ユーザーID + 加盟店名 / 商品キー）のため
// 専用 ID を設けない（09-aggregates.md #4/#5）。

export const BulkClassificationSessionIdSchema = idSchema.brand<'BulkClassificationSessionId'>()
export type BulkClassificationSessionId = z.infer<typeof BulkClassificationSessionIdSchema>

// --- Phase 5 M-A: 経費精算 ---

export const MonthlyExpenseCycleIdSchema = idSchema.brand<'MonthlyExpenseCycleId'>()
export type MonthlyExpenseCycleId = z.infer<typeof MonthlyExpenseCycleIdSchema>

export const ChildTransactionIdSchema = idSchema.brand<'ChildTransactionId'>()
export type ChildTransactionId = z.infer<typeof ChildTransactionIdSchema>

export const ExpenseTypeAccumulationIdSchema = idSchema.brand<'ExpenseTypeAccumulationId'>()
export type ExpenseTypeAccumulationId = z.infer<typeof ExpenseTypeAccumulationIdSchema>

// --- Phase 5 M-A: オンボーディング・認証 / 通知配信で共用 ---
// LineUserId は設けない（OQ-15: ユーザーID = LINE userID のため UserId を使う）。
// GmailOAuthToken 集約は UserId をキーとするため専用 ID を設けない。

export const TalkRoomIdSchema = idSchema.brand<'TalkRoomId'>()
export type TalkRoomId = z.infer<typeof TalkRoomIdSchema>

// --- Phase 5 M-A: マスタ管理 ---

export const MonthlyLimitIdSchema = idSchema.brand<'MonthlyLimitId'>()
export type MonthlyLimitId = z.infer<typeof MonthlyLimitIdSchema>

export const CategoryDeletionRequestIdSchema = idSchema.brand<'CategoryDeletionRequestId'>()
export type CategoryDeletionRequestId = z.infer<typeof CategoryDeletionRequestIdSchema>

export const ExpenseTypeDeletionRequestIdSchema = idSchema.brand<'ExpenseTypeDeletionRequestId'>()
export type ExpenseTypeDeletionRequestId = z.infer<typeof ExpenseTypeDeletionRequestIdSchema>

export const Phase0ConfigIdSchema = idSchema.brand<'Phase0ConfigId'>()
export type Phase0ConfigId = z.infer<typeof Phase0ConfigIdSchema>

// --- Phase 5 M-A: 通知配信 ---

export const DeliveryMessageIdSchema = idSchema.brand<'DeliveryMessageId'>()
export type DeliveryMessageId = z.infer<typeof DeliveryMessageIdSchema>

export const DeliveryLogIdSchema = idSchema.brand<'DeliveryLogId'>()
export type DeliveryLogId = z.infer<typeof DeliveryLogIdSchema>

export const FailsafeEmailIdSchema = idSchema.brand<'FailsafeEmailId'>()
export type FailsafeEmailId = z.infer<typeof FailsafeEmailIdSchema>

export const LineMessageIdSchema = idSchema.brand<'LineMessageId'>()
export type LineMessageId = z.infer<typeof LineMessageIdSchema>
