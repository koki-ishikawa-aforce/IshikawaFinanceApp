/**
 * 修正後分類（自動分類・学習コンテキストの分類値）
 * @see docs/domain/08b-ul-自動分類学習.md §2
 *
 * 用途は2つ:
 *  - `reflectManualClassification` の入力（08b §2「手動修正を学習に反映する」）
 *  - `applicableClassification` の出力（学習済みルールから導く適用可能な分類）
 *
 * 経費種別ID は費用区分が経費（business_expense）のときのみ意味を持つ。
 * 家計分析の `ConfirmedClassificationSchema`（取引確定入力）とは意図的に
 * 別スキーマにしている: あちらは「経費なら経費種別ID 必須」を superRefine で
 * 課すが、本スキーマは経費でも経費種別ID を任意にする。学習反映（T-2 軸独立）
 * では経費種別が未提供でも既存の学習済み経費種別軸を保持するため、必須化
 * すると軸独立の不変条件と衝突する。BC 境界を跨いだ共有を避けるため
 * 自動分類・学習コンテキスト内に閉じて定義する。
 */
import { z } from 'zod'
import { CategoryIdSchema, ExpenseTypeIdSchema } from '../../shared/ids'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'

export const ManualClassificationSchema = z.object({
  categoryId: CategoryIdSchema,
  expenseClass: ExpenseClassSchema,
  expenseTypeId: ExpenseTypeIdSchema.optional(),
})
export type ManualClassification = z.infer<typeof ManualClassificationSchema>
