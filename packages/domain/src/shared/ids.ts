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
