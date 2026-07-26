/**
 * 入金用途判別結果 / 出金用途（08d §1）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 * @see docs/domain/03-open-questions.md OQ-21
 *
 * kawasima:
 *   data 入金用途判別結果 = 給与判別 OR 経費精算入金判別 OR 別銀行戻し判別 OR 用途不明
 *   data 用途不明 = 取引ID AND 判別日時 AND 暫定処理
 *   data 暫定処理 = 手動確認待ち
 *   data 出金用途 = カード引落用 OR 別銀行振込用 OR NISA積立用 OR その他出金
 */
import { z } from 'zod'

/**
 * 用途不明の暫定処理（08d §1）。
 *
 * OQ-21（2026-07-24 改訂）で「25 万円以上は給与とみなす」保守処理から反転させた。
 * 旧処理は誤判別を黙って確定させるため、経費精算入金を給与と誤判定すると突合が
 * 発火せず月次レポートが最終確定に昇格しなくなる。
 */
export const ProvisionalHandlingSchema = z.literal('awaiting_manual_confirmation')
export type ProvisionalHandling = z.infer<typeof ProvisionalHandlingSchema>

/**
 * 自動確定できる入金用途（= 用途不明を除いた 3 種）。
 * 手動確認でユーザーが選べる選択肢もこの 3 種と一致する。
 */
export const DeterminedDepositPurposeSchema = z.enum([
  /** 給与判別 */
  'salary',
  /** 経費精算入金判別 */
  'expense_reimbursement',
  /** 別銀行戻し判別（別銀行貯蓄口座からの戻し） */
  'other_savings_return',
])
export type DeterminedDepositPurpose = z.infer<typeof DeterminedDepositPurposeSchema>

/** 入金用途判別結果。用途不明のみ暫定処理を伴う */
export const DepositPurposeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: DeterminedDepositPurposeSchema.extract(['salary']) }),
  z.object({ kind: DeterminedDepositPurposeSchema.extract(['expense_reimbursement']) }),
  z.object({ kind: DeterminedDepositPurposeSchema.extract(['other_savings_return']) }),
  z.object({ kind: z.literal('unknown'), provisionalHandling: ProvisionalHandlingSchema }),
])
export type DepositPurpose = z.infer<typeof DepositPurposeSchema>

/** 出金用途（08d §1）。シャドウ口座更新の事前条件に使う */
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
