/**
 * 学習参照 3 軸（T-2 フィールド独立）
 * @see docs/domain/08b-ul-自動分類学習.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 *
 * kawasima: data カテゴリ参照 = 学習済みカテゴリ OR カテゴリ未学習
 * kawasima: data 費用区分参照 = 学習済み費用区分 OR 費用区分未学習
 * kawasima: data 経費種別参照 = 学習済み経費種別 OR 経費種別未学習
 *
 * T-2: カテゴリ / 費用区分 / 経費種別は独立した参照として保持し、
 * 手動修正では修正された軸のみ更新される。
 */
import { z } from 'zod'
import {
  CategoryIdSchema,
  ExpenseTypeIdSchema,
  type CategoryId,
  type ExpenseTypeId,
} from '../../shared/ids'
import { ExpenseClassSchema, type ExpenseClass } from '../../shared/value-objects/ExpenseClass'
import { InvariantViolationError } from '../../shared/errors'
import type { LearningAxis } from './LearningAxis'

export const CategoryLearningRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('learned'), categoryId: CategoryIdSchema }),
  z.object({ kind: z.literal('unlearned') }),
])
export type CategoryLearningRef = z.infer<typeof CategoryLearningRefSchema>

export const ExpenseClassLearningRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('learned'), expenseClass: ExpenseClassSchema }),
  z.object({ kind: z.literal('unlearned') }),
])
export type ExpenseClassLearningRef = z.infer<typeof ExpenseClassLearningRefSchema>

export const ExpenseTypeLearningRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('learned'), expenseTypeId: ExpenseTypeIdSchema }),
  z.object({ kind: z.literal('unlearned') }),
])
export type ExpenseTypeLearningRef = z.infer<typeof ExpenseTypeLearningRefSchema>

/**
 * T-2 の 3 軸参照をまとめて保持する共通形。
 * 加盟店学習ルール（`MerchantLearningRule`）と Amazon商品キー学習ルール
 * （`AmazonProductKeyLearningRule`）はどちらもこの 3 軸を独立に持つため、
 * 反映・適用のロジックを両者で共有する（X-1 の加盟店/Amazon 二系統でも T-2 は同一）。
 */
export interface LearningRefs {
  categoryRef: CategoryLearningRef
  expenseClassRef: ExpenseClassLearningRef
  expenseTypeRef: ExpenseTypeLearningRef
}

/**
 * 学習に反映する分類値（UL「修正後分類」）の 3 軸。
 * 経費種別ID は費用区分が経費（business_expense）のときのみ意味を持つ。
 */
export interface LearnedClassificationInput {
  categoryId: CategoryId
  expenseClass: ExpenseClass
  // exactOptionalPropertyTypes 下でも ManualClassification（zod .optional()）を
  // そのまま渡せるよう、明示的に undefined を許容する
  expenseTypeId?: ExpenseTypeId | undefined
}

// 3 軸の等価判定は deriveLearnedRefs 内部でのみ使うためモジュール private に閉じる
function sameCategoryRef(a: CategoryLearningRef, b: CategoryLearningRef): boolean {
  return a.kind === 'unlearned'
    ? b.kind === 'unlearned'
    : b.kind === 'learned' && a.categoryId === b.categoryId
}

function sameExpenseClassRef(a: ExpenseClassLearningRef, b: ExpenseClassLearningRef): boolean {
  return a.kind === 'unlearned'
    ? b.kind === 'unlearned'
    : b.kind === 'learned' && a.expenseClass === b.expenseClass
}

function sameExpenseTypeRef(a: ExpenseTypeLearningRef, b: ExpenseTypeLearningRef): boolean {
  return a.kind === 'unlearned'
    ? b.kind === 'unlearned'
    : b.kind === 'learned' && a.expenseTypeId === b.expenseTypeId
}

/**
 * 既存の 3 軸参照へ修正後分類を反映し、次の参照と値が変わった軸を導出する（T-2 軸独立）。
 * 費用区分が経費以外へ変わっても学習済み経費種別軸は保持する（触らない）。
 */
export function deriveLearnedRefs(
  base: LearningRefs,
  input: LearnedClassificationInput,
): LearningRefs & { updatedAxes: LearningAxis[] } {
  const categoryRef: CategoryLearningRef = { kind: 'learned', categoryId: input.categoryId }
  const expenseClassRef: ExpenseClassLearningRef = {
    kind: 'learned',
    expenseClass: input.expenseClass,
  }
  const expenseTypeRef: ExpenseTypeLearningRef =
    input.expenseClass === 'business_expense' && input.expenseTypeId !== undefined
      ? { kind: 'learned', expenseTypeId: input.expenseTypeId }
      : base.expenseTypeRef

  const updatedAxes: LearningAxis[] = []
  if (!sameCategoryRef(base.categoryRef, categoryRef)) updatedAxes.push('category')
  if (!sameExpenseClassRef(base.expenseClassRef, expenseClassRef)) updatedAxes.push('expense_class')
  if (!sameExpenseTypeRef(base.expenseTypeRef, expenseTypeRef)) updatedAxes.push('expense_type')

  return { categoryRef, expenseClassRef, expenseTypeRef, updatedAxes }
}

/**
 * 学習済み 3 軸から適用可能な分類を導出する。未学習軸が残るルールは適用不可（T-2）。
 * この不変条件を domain に一元化し、api / adapters 層で再実装しない（CLAUDE.md）。
 *  - カテゴリ・費用区分のいずれかが未学習 → 適用不可
 *  - 経費(会社) かつ経費種別が未学習 → 適用不可
 * `label` は不変条件違反メッセージ用の識別子（加盟店名 / Amazon商品キー）。
 */
export function applicableClassificationFromRefs(
  refs: LearningRefs,
  label: string,
): LearnedClassificationInput {
  if (refs.categoryRef.kind !== 'learned' || refs.expenseClassRef.kind !== 'learned') {
    throw new InvariantViolationError(`学習が完了していないルールは適用できない: ${label}`)
  }
  const expenseClass = refs.expenseClassRef.expenseClass
  if (expenseClass === 'business_expense' && refs.expenseTypeRef.kind !== 'learned') {
    throw new InvariantViolationError(`経費種別が未学習のため適用できない: ${label}`)
  }
  return {
    categoryId: refs.categoryRef.categoryId,
    expenseClass,
    ...(expenseClass === 'business_expense' && refs.expenseTypeRef.kind === 'learned'
      ? { expenseTypeId: refs.expenseTypeRef.expenseTypeId }
      : {}),
  }
}
