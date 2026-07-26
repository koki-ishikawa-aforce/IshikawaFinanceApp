/**
 * 出金用途（08d §1）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 *
 * kawasima: data 出金用途 = カード引落用 OR 別銀行振込用 OR NISA積立用 OR その他出金
 *
 * 入金用途判別結果とは別語彙のため、ファイルを分けている。
 */
import { z } from 'zod'

export const WithdrawalPurposeSchema = z.enum([
  /** カード引落用 */
  'card_settlement',
  /** 別銀行振込用（= 別銀行貯蓄残高への加算） */
  'other_savings_transfer',
  /** NISA積立用 */
  'nisa_contribution',
  /** その他出金 */
  'other',
])
export type WithdrawalPurpose = z.infer<typeof WithdrawalPurposeSchema>

/** 別銀行貯蓄口座の相手方名パターン（正規化済み）。出金用途の判別に使う唯一の入力 */
export const OtherSavingsCounterpartyNamesSchema = z.array(z.string().min(1))
export type OtherSavingsCounterpartyNames = z.infer<typeof OtherSavingsCounterpartyNamesSchema>
