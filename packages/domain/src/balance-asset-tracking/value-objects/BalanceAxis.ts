/**
 * 残高軸（残高・資産推移管理コンテキスト、#398）
 * @see docs/domain/08d-ul-残高資産推移管理.md §1
 *
 * kawasima: data 残高軸 = SMBC銀行残高 OR 別銀行貯蓄残高 OR NISA積立累計 OR カード未払い合計
 *
 * 資産の推移グラフが描く 4 本の線に対応する。口座種別（AccountKind）と 1:1 で対応するが
 * 別の概念として持つ: 口座は「どの金融機関の入れ物か」、残高軸は「どの数値の推移か」で、
 * 三井住友カードは残高ではなく未払い合計を追う。
 */
import { z } from 'zod'
import { type AccountKind } from './AccountKind'

export const BalanceAxisSchema = z.enum([
  'smbc_balance',
  'other_savings_balance',
  'nisa_contribution',
  'card_unpaid',
])
export type BalanceAxis = z.infer<typeof BalanceAxisSchema>

const AXIS_BY_ACCOUNT_KIND: Record<AccountKind, BalanceAxis> = {
  smbc_bank: 'smbc_balance',
  other_savings: 'other_savings_balance',
  nisa: 'nisa_contribution',
  mitsui_sumitomo_card: 'card_unpaid',
}

/**
 * 口座種別から残高軸を決める。
 * 変動を記録する側は口座しか手元に無い（イベントが載せるのは口座IDのみ）ため、
 * 軸の対応付けをここに一本化して呼び出し側ごとの取り違えを防ぐ。
 */
export function balanceAxisOfAccountKind(kind: AccountKind): BalanceAxis {
  return AXIS_BY_ACCOUNT_KIND[kind]
}
