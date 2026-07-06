import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { MonthlyLimitIdSchema, UserIdSchema, ExpenseTypeIdSchema } from '../../shared/ids'
import { SeedLimitSchema } from '../value-objects/SeedLimit'

/** 月次上限 seed 投入イベント（08h §3） */
export const MonthlyLimitSeedInsertedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MonthlyLimitSeedInserted'),
  monthlyLimitId: MonthlyLimitIdSchema,
  userId: UserIdSchema,
  expenseTypeId: ExpenseTypeIdSchema,
  seedLimit: SeedLimitSchema,
})
export type MonthlyLimitSeedInserted = z.infer<typeof MonthlyLimitSeedInsertedSchema>

/**
 * 月次上限変更イベント（08h §3）
 * 事後条件: 経費精算へ変更を通知し、当月の按分が再計算される（結果整合、09 §2.3）。
 */
export const MonthlyLimitChangedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MonthlyLimitChanged'),
  monthlyLimitId: MonthlyLimitIdSchema,
  oldLimit: SeedLimitSchema,
  newLimit: SeedLimitSchema,
  changedByUserId: UserIdSchema,
})
export type MonthlyLimitChanged = z.infer<typeof MonthlyLimitChangedSchema>

/** 月次上限新規設定イベント（08h §3。追加経費種別への上限設定） */
export const MonthlyLimitCreatedSchema = DomainEventBaseSchema.extend({
  type: z.literal('MonthlyLimitCreated'),
  monthlyLimitId: MonthlyLimitIdSchema,
  userId: UserIdSchema,
  expenseTypeId: ExpenseTypeIdSchema,
  seedLimit: SeedLimitSchema,
})
export type MonthlyLimitCreated = z.infer<typeof MonthlyLimitCreatedSchema>
