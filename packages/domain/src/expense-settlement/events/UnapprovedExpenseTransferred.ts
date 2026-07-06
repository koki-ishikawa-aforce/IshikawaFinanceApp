import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { MonthlyExpenseCycleIdSchema } from '../../shared/ids'
import { MoneySchema } from '../../shared/value-objects/Money'
import { PersonalExpenseClassSchema } from '../../shared/value-objects/PersonalExpenseClass'

/** 経費突合差額振替イベント（08e §3。不認定分を個人費用へ振替） */
export const UnapprovedExpenseTransferredSchema = DomainEventBaseSchema.extend({
  type: z.literal('UnapprovedExpenseTransferred'),
  monthlyExpenseCycleId: MonthlyExpenseCycleIdSchema,
  unapprovedTotal: MoneySchema,
  transferTargets: z.array(PersonalExpenseClassSchema),
})
export type UnapprovedExpenseTransferred = z.infer<typeof UnapprovedExpenseTransferredSchema>
