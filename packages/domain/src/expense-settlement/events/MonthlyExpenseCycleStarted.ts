import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { MonthlyExpenseCycleIdSchema, UserIdSchema } from '../../shared/ids'
import { YearMonthSchema } from '../../shared/value-objects/YearMonth'

/** 月次経費サイクル開始イベント（08e §3） */
export const MonthlyExpenseCycleStartedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MonthlyExpenseCycleStarted'),
  monthlyExpenseCycleId: MonthlyExpenseCycleIdSchema,
  userId: UserIdSchema,
  targetYearMonth: YearMonthSchema,
})
export type MonthlyExpenseCycleStarted = z.infer<typeof MonthlyExpenseCycleStartedSchema>
