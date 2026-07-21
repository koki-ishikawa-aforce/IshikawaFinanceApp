import { z } from 'zod'
import { DomainEventBaseSchema } from '../../shared/events/DomainEvent'
import {
  CategoryIdSchema,
  ExpenseTypeIdSchema,
  TransactionIdSchema,
  UserIdSchema,
} from '../../shared/ids'
import { ExpenseClassSchema } from '../../shared/value-objects/ExpenseClass'

/**
 * 確定分類（08c §3。kawasima: data 確定分類 = カテゴリID AND 費用区分 AND 経費種別ID?）
 * 経費種別ID は費用区分が経費（business_expense）のときのみ意味を持つ。
 */
export const ConfirmedClassificationSchema = z
  .object({
    categoryId: CategoryIdSchema,
    expenseClass: ExpenseClassSchema,
    expenseTypeId: ExpenseTypeIdSchema.optional(),
  })
  .superRefine((classification, ctx) => {
    if (
      classification.expenseClass === 'business_expense' &&
      classification.expenseTypeId === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '経費（business_expense）の確定分類には経費種別ID が必須',
        path: ['expenseTypeId'],
      })
    }
  })
export type ConfirmedClassification = z.infer<typeof ConfirmedClassificationSchema>

/**
 * 取引が手動分類確定したイベント（08c §3）
 * 加盟店名は下流（自動分類・学習）が学習ルールを引くために保持する。
 */
export const TransactionManuallyClassifiedSchema = DomainEventBaseSchema.extend({
  type: z.literal('TransactionManuallyClassified'),
  transactionId: TransactionIdSchema,
  userId: UserIdSchema,
  merchantName: z.string().min(1),
  confirmedClassification: ConfirmedClassificationSchema,
})
export type TransactionManuallyClassified = z.infer<typeof TransactionManuallyClassifiedSchema>
