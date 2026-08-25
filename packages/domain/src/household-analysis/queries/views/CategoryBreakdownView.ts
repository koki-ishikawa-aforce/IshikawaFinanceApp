import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { CategoryIdSchema } from '../../../shared/ids'

export const CategoryBreakdownItemSchema = z.object({
  categoryId: CategoryIdSchema,
  categoryName: z.string(),
  total: MoneySchema,
  count: z.number().int().nonnegative(),
  // 世帯支出(個人モードは個人支出)の当月合計に対する構成比。合計が 0 円以下の月
  // (相殺・返金超過)は割合そのものが定義できないため null(算出不能)を返す。
  percentage: z.number().min(0).max(100).nullable(),
})
export type CategoryBreakdownItem = z.infer<typeof CategoryBreakdownItemSchema>

export const CategoryBreakdownViewSchema = z.object({
  mode: z.enum(['household', 'personal']),
  yearMonth: z.string(),
  totalAmount: MoneySchema,
  items: z.array(CategoryBreakdownItemSchema),
})
export type CategoryBreakdownView = z.infer<typeof CategoryBreakdownViewSchema>
