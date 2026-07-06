/**
 * CSV 取込完了 View（通知配信のリマインダー停止判定が読む）
 * @see docs/domain/08a-ul-取引取込.md §2
 * @see docs/domain/08g-ul-通知配信.md §2
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.3
 */
import { z } from 'zod'
import { UserIdSchema, ImportJobIdSchema } from '../../../shared/ids'
import { YearMonthSchema } from '../../../shared/value-objects/YearMonth'

export const CsvImportCompletionViewSchema = z.object({
  userId: UserIdSchema,
  targetMonth: YearMonthSchema,
  importJobId: ImportJobIdSchema,
  completedAt: z.date(),
})
export type CsvImportCompletionView = z.infer<typeof CsvImportCompletionViewSchema>
