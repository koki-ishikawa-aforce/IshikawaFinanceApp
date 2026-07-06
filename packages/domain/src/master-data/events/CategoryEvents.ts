import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import { CategoryIdSchema, CategoryDeletionRequestIdSchema, UserIdSchema } from '../../shared/ids'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'
import { DefaultCategoryKindSchema } from '../aggregates/CategoryMaster'

/** カテゴリ seed 投入イベント（08h §3） */
export const CategorySeedInsertedSchema = DomainEventBaseSchema.extend({
  type: z.literal('CategorySeedInserted'),
  categoryId: CategoryIdSchema,
  defaultKind: DefaultCategoryKindSchema,
  insertedAt: z.date(),
})
export type CategorySeedInserted = z.infer<typeof CategorySeedInsertedSchema>

/** カテゴリ追加イベント（08h §3） */
export const CategoryAddedSchema = DomainEventBaseSchema.extend({
  type: z.literal('CategoryAdded'),
  categoryId: CategoryIdSchema,
  name: z.string().min(1),
  createdByUserId: UserIdSchema,
})
export type CategoryAdded = z.infer<typeof CategoryAddedSchema>

/** カテゴリ改名イベント（08h §3。追加カテゴリのみ、作成者本人のみ） */
export const CategoryRenamedSchema = DomainEventBaseSchema.extend({
  type: z.literal('CategoryRenamed'),
  categoryId: CategoryIdSchema,
  oldName: z.string().min(1),
  newName: z.string().min(1),
  renamedByUserId: UserIdSchema,
})
export type CategoryRenamed = z.infer<typeof CategoryRenamedSchema>

/** カテゴリ削除リマップ依頼イベント（08h §3。下流 3 コンテキストへの要請） */
export const CategoryDeletionRemapRequestedSchema = DomainEventBaseSchema.extend({
  type: z.literal('CategoryDeletionRemapRequested'),
  categoryDeletionRequestId: CategoryDeletionRequestIdSchema,
  targetCategoryId: CategoryIdSchema,
  destinationCategoryId: CategoryIdSchema,
  destinationExpenseClass: ExpenseClassSchema,
})
export type CategoryDeletionRemapRequested = z.infer<typeof CategoryDeletionRemapRequestedSchema>

/** カテゴリ削除完了イベント（08h §3。全リマップ完了通知後の物理削除） */
export const CategoryDeletionCompletedSchema = DomainEventBaseSchema.extend({
  type: z.literal('CategoryDeletionCompleted'),
  categoryDeletionRequestId: CategoryDeletionRequestIdSchema,
  affectedTransactionCount: z.number().int().nonnegative(),
  affectedLearningRuleCount: z.number().int().nonnegative(),
})
export type CategoryDeletionCompleted = z.infer<typeof CategoryDeletionCompletedSchema>
