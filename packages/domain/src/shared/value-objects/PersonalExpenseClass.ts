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

export const PersonalExpenseClassSchema = z.enum(['personal_honey', 'personal_darling'])
export type PersonalExpenseClass = z.infer<typeof PersonalExpenseClassSchema>
