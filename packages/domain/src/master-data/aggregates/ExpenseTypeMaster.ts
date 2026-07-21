/**
 * 経費種別マスタ集約（マスタ管理コンテキスト）
 * @see docs/domain/08h-ul-マスタ管理.md §1
 * @see docs/domain/09-aggregates.md #19
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.5
 *
 * kawasima: data 経費種別マスタ = 規定経費種別 OR 追加経費種別
 *
 * 不変条件: カテゴリマスタと同構造（規定は削除・改名不可・世帯共有、追加は個人別）。
 * 名前一意性は save 前に findAllVisibleToUser の結果へ assertExpenseTypeNameAvailable を適用して保証する。
 */
import { z } from 'zod'
import { InvariantViolationError } from '../../shared/errors/DomainError'
import { ExpenseTypeIdSchema, UserIdSchema, type ExpenseTypeId } from '../../shared/ids'
import { OwnershipScopeSchema } from '../value-objects/OwnershipScope'
import { RenameRecordSchema } from '../value-objects/RenameRecord'

/** 規定経費種別（5 種、削除・改名不可） */
export const DefaultExpenseTypeKindSchema = z.enum([
  'gym',
  'books_newspaper',
  'ai_usage',
  'transportation',
  'other_expense',
])
export type DefaultExpenseTypeKind = z.infer<typeof DefaultExpenseTypeKindSchema>

export const ExpenseTypeMasterSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('default'),
      expenseTypeId: ExpenseTypeIdSchema,
      name: z.string().min(1),
      scope: OwnershipScopeSchema,
      defaultKind: DefaultExpenseTypeKindSchema,
    }),
    z.object({
      kind: z.literal('custom'),
      expenseTypeId: ExpenseTypeIdSchema,
      name: z.string().min(1),
      scope: OwnershipScopeSchema,
      createdAt: z.date(),
      createdByUserId: UserIdSchema,
      renameHistory: z.array(RenameRecordSchema),
    }),
  ])
  .superRefine((expenseType, ctx) => {
    if (expenseType.kind === 'default' && expenseType.scope.kind !== 'household_shared') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '規定経費種別は世帯共有スコープでなければならない',
        path: ['scope'],
      })
    }
    if (expenseType.kind === 'custom' && expenseType.scope.kind !== 'personal') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '追加経費種別は個人別スコープでなければならない',
        path: ['scope'],
      })
    }
  })
export type ExpenseTypeMaster = z.infer<typeof ExpenseTypeMasterSchema>

export type DefaultExpenseType = Extract<ExpenseTypeMaster, { kind: 'default' }>
export type CustomExpenseType = Extract<ExpenseTypeMaster, { kind: 'custom' }>

/**
 * 名前一意性の検査（08h「名前重複エラー」）。新設・改名の save 前に、
 * findAllVisibleToUser の結果（世帯共有 + 本人の個人別）を渡して呼び出す。
 * 改名時は excludeExpenseTypeId に自身の ID を渡す。
 */
export function assertExpenseTypeNameAvailable(
  visibleExpenseTypes: ExpenseTypeMaster[],
  name: string,
  excludeExpenseTypeId?: ExpenseTypeId,
): void {
  if (visibleExpenseTypes.some(e => e.expenseTypeId !== excludeExpenseTypeId && e.name === name)) {
    throw new InvariantViolationError(`経費種別名「${name}」は既に使用されている`)
  }
}

/** 追加経費種別の改名（規定経費種別の改名関数は提供しない = 改名不可の構造表現） */
export function renameCustomExpenseType(
  expenseType: CustomExpenseType,
  newName: string,
  renamedByUserId: CustomExpenseType['createdByUserId'],
  at: Date,
): CustomExpenseType {
  return ExpenseTypeMasterSchema.parse({
    ...expenseType,
    name: newName,
    renameHistory: [
      ...expenseType.renameHistory,
      { oldName: expenseType.name, newName, renamedAt: at, renamedByUserId },
    ],
  }) as CustomExpenseType
}
