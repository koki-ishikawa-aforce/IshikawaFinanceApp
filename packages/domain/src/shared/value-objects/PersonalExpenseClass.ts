/**
 * 個人費用区分（費用区分のうち個人 2 値のサブセット）
 * @see docs/domain/08b-ul-自動分類学習.md §1
 * @see docs/domain/08e-ul-経費精算.md §1
 *
 * kawasima: data デフォルト費用区分 = 個人(夫) OR 個人(妻)
 *
 * 未分類取引の暫定区分（A-1: カード所有者の個人(本人) をデフォルトに置く）と、
 * 経費精算の按分子取引・不認定分振替先で使う。
 * `DefaultExpenseClass` は UL 上の同義語（値空間は同一）。
 */
import { z } from 'zod'
import type { ExpenseClass } from './ExpenseClass'
import type { UserRole } from './UserRole'
import { InvariantViolationError } from '../errors'

export const PersonalExpenseClassSchema = z.enum(['personal_honey', 'personal_darling'])
export type PersonalExpenseClass = z.infer<typeof PersonalExpenseClassSchema>

/** UL 上の同義語（未分類取引の暫定区分）。値空間は PersonalExpenseClass と同一 */
export const DefaultExpenseClassSchema = PersonalExpenseClassSchema
export type DefaultExpenseClass = PersonalExpenseClass

/** ロール → 個人費用区分（personal_honey = 夫 = honey, personal_darling = 妻 = darling） */
export function roleToPersonalExpenseClass(role: UserRole): PersonalExpenseClass {
  return role === 'honey' ? 'personal_honey' : 'personal_darling'
}

/**
 * 個人費用区分と所有者ロールの整合を検証する（不変条件）。
 *
 * personal_honey は夫（honey）の、personal_darling は妻（darling）の個人費用を表す
 * ため、取引の所有者ロールと一致していなければならない。所有者と異なる相手の
 * 個人費用区分を付けると、月次レポート / ダッシュボードの個人合計が費用区分で
 * 集計される（所有者では集計しない）ため、相手の個人合計へ誤って計上されてしまう。
 * 世帯・経費(会社) は本検証の対象外（所有者ロールに縛られない）。
 */
export function assertPersonalExpenseClassMatchesRole(
  expenseClass: ExpenseClass,
  ownerRole: UserRole,
): void {
  if (expenseClass === 'personal_honey' && ownerRole !== 'honey') {
    throw new InvariantViolationError('個人(夫) の費用区分は夫（honey）所有の取引にのみ付与できる')
  }
  if (expenseClass === 'personal_darling' && ownerRole !== 'darling') {
    throw new InvariantViolationError(
      '個人(妻) の費用区分は妻（darling）所有の取引にのみ付与できる',
    )
  }
}
