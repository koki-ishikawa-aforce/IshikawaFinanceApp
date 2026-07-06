import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import {
  ExpenseTypeIdSchema,
  ExpenseTypeDeletionRequestIdSchema,
  UserIdSchema,
} from '../../shared/ids'
import { DefaultExpenseTypeKindSchema } from '../aggregates/ExpenseTypeMaster'

/** 経費種別 seed 投入イベント（08h §3） */
export const ExpenseTypeSeedInsertedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseTypeSeedInserted'),
  expenseTypeId: ExpenseTypeIdSchema,
  defaultKind: DefaultExpenseTypeKindSchema,
  insertedAt: z.date(),
})
export type ExpenseTypeSeedInserted = z.infer<typeof ExpenseTypeSeedInsertedSchema>

/** 経費種別追加イベント（08h §3） */
export const ExpenseTypeAddedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseTypeAdded'),
  expenseTypeId: ExpenseTypeIdSchema,
  name: z.string().min(1),
  createdByUserId: UserIdSchema,
})
export type ExpenseTypeAdded = z.infer<typeof ExpenseTypeAddedSchema>

/** 経費種別改名イベント（08h §3） */
export const ExpenseTypeRenamedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseTypeRenamed'),
  expenseTypeId: ExpenseTypeIdSchema,
  oldName: z.string().min(1),
  newName: z.string().min(1),
  renamedByUserId: UserIdSchema,
})
export type ExpenseTypeRenamed = z.infer<typeof ExpenseTypeRenamedSchema>

/** 経費種別削除リマップ依頼イベント（08h §3） */
export const ExpenseTypeDeletionRemapRequestedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseTypeDeletionRemapRequested'),
  expenseTypeDeletionRequestId: ExpenseTypeDeletionRequestIdSchema,
  targetExpenseTypeId: ExpenseTypeIdSchema,
  destinationExpenseTypeId: ExpenseTypeIdSchema,
})
export type ExpenseTypeDeletionRemapRequested = z.infer<
  typeof ExpenseTypeDeletionRemapRequestedSchema
>

/** 経費種別削除完了イベント（08h §3） */
export const ExpenseTypeDeletionCompletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('ExpenseTypeDeletionCompleted'),
  expenseTypeDeletionRequestId: ExpenseTypeDeletionRequestIdSchema,
  affectedTransactionCount: z.number().int().nonnegative(),
  affectedLearningRuleCount: z.number().int().nonnegative(),
})
export type ExpenseTypeDeletionCompleted = z.infer<typeof ExpenseTypeDeletionCompletedSchema>
