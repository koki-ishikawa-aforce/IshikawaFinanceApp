import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'
import { CategoryIdSchema } from '../../../shared/ids'

export const CategoryBreakdownItemSchema = z.object({
  categoryId: CategoryIdSchema,
  categoryName: z.string(),
  total: MoneySchema,
  count: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
})
export type CategoryBreakdownItem = z.infer<typeof CategoryBreakdownItemSchema>

export const CategoryBreakdownViewSchema = z.object({
  mode: z.enum(['household', 'personal']),
  yearMonth: z.string(),
  totalAmount: MoneySchema,
  items: z.array(CategoryBreakdownItemSchema),
})
export type CategoryBreakdownView = z.infer<typeof CategoryBreakdownViewSchema>
