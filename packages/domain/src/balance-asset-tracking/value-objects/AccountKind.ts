/**
 * 口座種別（残高・資産推移管理コンテキスト）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 *
 * kawasima: data 口座種別 = SMBC銀行 OR 三井住友カード OR 別銀行貯蓄 OR NISA
 *
 * AccountSchema（aggregates/Account.ts）の discriminated union の kind リテラルと
 * 同一の値集合。種別を追加する際は両方を更新する。
 */
import { z } from 'zod'

export const AccountKindSchema = z.enum([
  'smbc_bank',
  'mitsui_sumitomo_card',
  'other_savings',
  'nisa',
])
export type AccountKind = z.infer<typeof AccountKindSchema>
