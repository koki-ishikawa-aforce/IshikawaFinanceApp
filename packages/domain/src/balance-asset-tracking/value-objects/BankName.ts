/**
 * 別銀行貯蓄口座の表示用銀行名（per-user 編集可、Phase 3.5 追加）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 */
import { z } from 'zod'

export const BankNameSchema = z.string().min(1).max(50).brand<'BankName'>()
export type BankName = z.infer<typeof BankNameSchema>
