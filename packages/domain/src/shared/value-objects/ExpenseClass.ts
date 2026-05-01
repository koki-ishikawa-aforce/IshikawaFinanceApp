/**
 * 費用区分 enum
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §4.2
 *
 * kawasima: data 費用区分 = 世帯 OR 個人(夫) OR 個人(妻) OR 経費(会社)
 *
 * Honey/Darling の対応は Phase 3.5 で確定:
 * - personal_honey  = 夫
 * - personal_darling = 妻
 */
import { z } from 'zod'

export const ExpenseClassSchema = z.enum([
  'household',
  'personal_honey',
  'personal_darling',
  'business_expense',
])
export type ExpenseClass = z.infer<typeof ExpenseClassSchema>
