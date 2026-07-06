/**
 * 学習参照 3 軸（T-2 フィールド独立）
 * @see docs/domain/08b-ul-自動分類学習.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 *
 * kawasima: data カテゴリ参照 = 学習済みカテゴリ OR カテゴリ未学習
 * kawasima: data 費用区分参照 = 学習済み費用区分 OR 費用区分未学習
 * kawasima: data 経費種別参照 = 学習済み経費種別 OR 経費種別未学習
 *
 * T-2: カテゴリ / 費用区分 / 経費種別は独立した参照として保持し、
 * 手動修正では修正された軸のみ更新される。
 */
import { z } from 'zod'
import { CategoryIdSchema, ExpenseTypeIdSchema } from '../../shared/ids'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'

export const CategoryLearningRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('learned'), categoryId: CategoryIdSchema }),
  z.object({ kind: z.literal('unlearned') }),
])
export type CategoryLearningRef = z.infer<typeof CategoryLearningRefSchema>

export const ExpenseClassLearningRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('learned'), expenseClass: ExpenseClassSchema }),
  z.object({ kind: z.literal('unlearned') }),
])
export type ExpenseClassLearningRef = z.infer<typeof ExpenseClassLearningRefSchema>

export const ExpenseTypeLearningRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('learned'), expenseTypeId: ExpenseTypeIdSchema }),
  z.object({ kind: z.literal('unlearned') }),
])
export type ExpenseTypeLearningRef = z.infer<typeof ExpenseTypeLearningRefSchema>
