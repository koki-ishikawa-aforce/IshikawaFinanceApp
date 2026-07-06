/**
 * 更新軸（手動修正で書き換わった学習軸）
 * @see docs/domain/08b-ul-自動分類学習.md §3
 *
 * kawasima: data 更新軸 = カテゴリ軸 OR 費用区分軸 OR 経費種別軸
 */
import { z } from 'zod'

export const LearningAxisSchema = z.enum(['category', 'expense_class', 'expense_type'])
export type LearningAxis = z.infer<typeof LearningAxisSchema>
