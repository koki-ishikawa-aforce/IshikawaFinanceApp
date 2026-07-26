/**
 * Branded ID 型一式
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.1
 * @see docs/superpowers/specs/2026-07-06-phase5-m-b-db-schema-design.md §2.3（OQ-41 確定）
 *
 * 内部発番 ID（24 種）は ULID（26 文字 Crockford Base32、時系列ソート可能）。
 * 生成は adapter 層で行い、ドメイン層は生成済み文字列を受け取るのみ。
 * 外部由来 ID（6 種: UserId / TalkRoomId / LineMessageId / GmailMessageId /
 * AmazonOrderId / SettlementNoticeId）は形式が発行元依存のため min(1) を維持する。
 */
import { z } from 'zod'

/**
 * ULID 形式。先頭桁 0–7 制限で 128bit 範囲外の文字列を排除する。
 *
 * zod 組み込みの z.string().ulid() は大文字小文字を区別せず先頭 8–Z も許容するため、
 * 意図的に使用しない（canonical な大文字表現のみ受理する方針。小文字化された ULID が
 * 入り得る境界では adapter 層で toUpperCase() 正規化してからドメインに渡すこと）。
 * adapter 層（DB CHECK 制約・ULID 生成の検証）でも同一ポリシーを参照するため export する。
 */
export const ULID_REGEX = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/

/** 内部発番 ID 用（ULID） */
const ulidSchema = z.string().regex(ULID_REGEX)

/** 外部由来 ID 用（形式は発行元依存のため存在チェックのみ） */
const externalIdSchema = z.string().min(1)

export const TransactionIdSchema = ulidSchema.brand<'TransactionId'>()
export type TransactionId = z.infer<typeof TransactionIdSchema>

export const UserIdSchema = externalIdSchema.brand<'UserId'>()
export type UserId = z.infer<typeof UserIdSchema>

export const CategoryIdSchema = ulidSchema.brand<'CategoryId'>()
export type CategoryId = z.infer<typeof CategoryIdSchema>

export const ExpenseTypeIdSchema = ulidSchema.brand<'ExpenseTypeId'>()
export type ExpenseTypeId = z.infer<typeof ExpenseTypeIdSchema>

export const AccountIdSchema = ulidSchema.brand<'AccountId'>()
export type AccountId = z.infer<typeof AccountIdSchema>

export const BankDepositIdSchema = ulidSchema.brand<'BankDepositId'>()
export type BankDepositId = z.infer<typeof BankDepositIdSchema>

export const MitsuiSumitomoUnpaidIdSchema = ulidSchema.brand<'MitsuiSumitomoUnpaidId'>()
export type MitsuiSumitomoUnpaidId = z.infer<typeof MitsuiSumitomoUnpaidIdSchema>

export const UnpaidEntryIdSchema = ulidSchema.brand<'UnpaidEntryId'>()
export type UnpaidEntryId = z.infer<typeof UnpaidEntryIdSchema>

export const MonthlyReportIdSchema = ulidSchema.brand<'MonthlyReportId'>()
export type MonthlyReportId = z.infer<typeof MonthlyReportIdSchema>

export const ExpenseReimbursementIdSchema = ulidSchema.brand<'ExpenseReimbursementId'>()
export type ExpenseReimbursementId = z.infer<typeof ExpenseReimbursementIdSchema>

export const SettlementNoticeIdSchema = externalIdSchema.brand<'SettlementNoticeId'>()
export type SettlementNoticeId = z.infer<typeof SettlementNoticeIdSchema>

export const GmailMessageIdSchema = externalIdSchema.brand<'GmailMessageId'>()
export type GmailMessageId = z.infer<typeof GmailMessageIdSchema>

// --- Phase 5 M-A: 取引取込 ---

export const TransactionCandidateIdSchema = ulidSchema.brand<'TransactionCandidateId'>()
export type TransactionCandidateId = z.infer<typeof TransactionCandidateIdSchema>

export const ImportBatchIdSchema = ulidSchema.brand<'ImportBatchId'>()
export type ImportBatchId = z.infer<typeof ImportBatchIdSchema>

export const ImportJobIdSchema = ulidSchema.brand<'ImportJobId'>()
export type ImportJobId = z.infer<typeof ImportJobIdSchema>

export const UploadFileIdSchema = ulidSchema.brand<'UploadFileId'>()
export type UploadFileId = z.infer<typeof UploadFileIdSchema>

export const PdfConversionJobIdSchema = ulidSchema.brand<'PdfConversionJobId'>()
export type PdfConversionJobId = z.infer<typeof PdfConversionJobIdSchema>

export const AmazonOrderIdSchema = externalIdSchema.brand<'AmazonOrderId'>()
export type AmazonOrderId = z.infer<typeof AmazonOrderIdSchema>

// --- Phase 5 M-A: 自動分類・学習 ---
// 加盟店学習ルール / Amazon商品キー学習ルールは自然キー（ユーザーID + 加盟店名 / 商品キー）のため
// 専用 ID を設けない（09-aggregates.md #4/#5）。

export const BulkClassificationSessionIdSchema = ulidSchema.brand<'BulkClassificationSessionId'>()
export type BulkClassificationSessionId = z.infer<typeof BulkClassificationSessionIdSchema>

// --- Phase 5 M-A: 経費精算 ---

export const MonthlyExpenseCycleIdSchema = ulidSchema.brand<'MonthlyExpenseCycleId'>()
export type MonthlyExpenseCycleId = z.infer<typeof MonthlyExpenseCycleIdSchema>

export const ChildTransactionIdSchema = ulidSchema.brand<'ChildTransactionId'>()
export type ChildTransactionId = z.infer<typeof ChildTransactionIdSchema>

export const ExpenseTypeAccumulationIdSchema = ulidSchema.brand<'ExpenseTypeAccumulationId'>()
export type ExpenseTypeAccumulationId = z.infer<typeof ExpenseTypeAccumulationIdSchema>

// --- Phase 5 M-A: オンボーディング・認証 / 通知配信で共用 ---
// LineUserId は設けない（OQ-15: ユーザーID = LINE userID のため UserId を使う）。
// GmailOAuthToken 集約は UserId をキーとするため専用 ID を設けない。

export const TalkRoomIdSchema = externalIdSchema.brand<'TalkRoomId'>()
export type TalkRoomId = z.infer<typeof TalkRoomIdSchema>

// --- Phase 5 M-A: マスタ管理 ---

export const MonthlyLimitIdSchema = ulidSchema.brand<'MonthlyLimitId'>()
export type MonthlyLimitId = z.infer<typeof MonthlyLimitIdSchema>

export const CategoryDeletionRequestIdSchema = ulidSchema.brand<'CategoryDeletionRequestId'>()
export type CategoryDeletionRequestId = z.infer<typeof CategoryDeletionRequestIdSchema>

export const ExpenseTypeDeletionRequestIdSchema = ulidSchema.brand<'ExpenseTypeDeletionRequestId'>()
export type ExpenseTypeDeletionRequestId = z.infer<typeof ExpenseTypeDeletionRequestIdSchema>

export const Phase0ConfigIdSchema = ulidSchema.brand<'Phase0ConfigId'>()
export type Phase0ConfigId = z.infer<typeof Phase0ConfigIdSchema>

// --- Phase 5 M-A: 通知配信 ---

export const DeliveryMessageIdSchema = ulidSchema.brand<'DeliveryMessageId'>()
export type DeliveryMessageId = z.infer<typeof DeliveryMessageIdSchema>

export const DeliveryLogIdSchema = ulidSchema.brand<'DeliveryLogId'>()
export type DeliveryLogId = z.infer<typeof DeliveryLogIdSchema>

export const FailsafeEmailIdSchema = ulidSchema.brand<'FailsafeEmailId'>()
export type FailsafeEmailId = z.infer<typeof FailsafeEmailIdSchema>

export const LineMessageIdSchema = externalIdSchema.brand<'LineMessageId'>()
export type LineMessageId = z.infer<typeof LineMessageIdSchema>
