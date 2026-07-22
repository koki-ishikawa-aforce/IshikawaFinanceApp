/**
 * 加盟店学習ルール集約（自動分類・学習コンテキスト）
 * @see docs/domain/08b-ul-自動分類学習.md §1
 * @see docs/domain/09-aggregates.md #4
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 *
 * kawasima: data 加盟店学習ルール = 有効加盟店学習ルール OR 学習無効化加盟店ルール
 *
 * 不変条件:
 *  - F-1: ユーザーID + 加盟店名で一意（Repository 検索で保証、Phase 5 M-B）
 *  - T-2: カテゴリ・費用区分・経費種別を独立した参照として保持
 *  - 有効ルールと学習無効化が同時に存在しない（discriminated union で構造表現）
 *  - X-1: 加盟店名「AMAZON.CO.JP」は加盟店学習の対象外（Amazon商品キー学習を使用）
 *
 * 専用 ID は持たない（自然キー = userId + merchantName、09-aggregates.md #4）。
 */
import { z } from 'zod'
import {
  CategoryIdSchema,
  ExpenseTypeIdSchema,
  UserIdSchema,
  type CategoryId,
  type ExpenseTypeId,
  type UserId,
} from '../../shared/ids'
import { ExpenseClassSchema, type ExpenseClass } from '../../shared/value-objects/ExpenseClass'
import { InvariantViolationError } from '../../shared/errors/DomainError'
import {
  CategoryLearningRefSchema,
  ExpenseClassLearningRefSchema,
  ExpenseTypeLearningRefSchema,
  type CategoryLearningRef,
  type ExpenseClassLearningRef,
  type ExpenseTypeLearningRef,
} from '../value-objects/LearningRefs'
import type { LearningAxis } from '../value-objects/LearningAxis'

/** 共通属性（自然キー） */
export const CommonMerchantLearningRuleAttrsSchema = z.object({
  userId: UserIdSchema,
  merchantName: z.string().min(1),
})
export type CommonMerchantLearningRuleAttrs = z.infer<typeof CommonMerchantLearningRuleAttrsSchema>

export const MerchantLearningRuleSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('active'),
      common: CommonMerchantLearningRuleAttrsSchema,
      categoryRef: CategoryLearningRefSchema,
      expenseClassRef: ExpenseClassLearningRefSchema,
      expenseTypeRef: ExpenseTypeLearningRefSchema,
      lastUpdatedAt: z.date(),
    }),
    z.object({
      kind: z.literal('disabled'),
      common: CommonMerchantLearningRuleAttrsSchema,
      disabledAt: z.date(),
    }),
  ])
  .superRefine((rule, ctx) => {
    if (isAmazonMerchant(rule.common.merchantName)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'AMAZON.CO.JP は加盟店学習の対象外（X-1、Amazon商品キー学習を使用）',
        path: ['common', 'merchantName'],
      })
    }
  })
export type MerchantLearningRule = z.infer<typeof MerchantLearningRuleSchema>

export type ActiveMerchantLearningRule = Extract<MerchantLearningRule, { kind: 'active' }>
export type DisabledMerchantLearningRule = Extract<MerchantLearningRule, { kind: 'disabled' }>

/** 有効ルールから取り出した確定分類の素性（BC 中立。household-analysis 型に依存しない） */
export interface ResolvedRuleClassification {
  categoryId: CategoryId
  expenseClass: ExpenseClass
  expenseTypeId?: ExpenseTypeId
}

/**
 * 学習済みの 3 軸から確定分類の素性を取り出す（08b §2 遡及適用の前提）。
 * 未学習軸が残るルールは適用できない。経費(会社) ⇒ 経費種別が学習済みであることも要求する。
 * 「学習が完了しているか」の判定を api / adapters 層で再実装させないためのドメイン関数。
 */
export function resolveActiveRuleClassification(
  rule: ActiveMerchantLearningRule,
): ResolvedRuleClassification {
  if (rule.categoryRef.kind !== 'learned' || rule.expenseClassRef.kind !== 'learned') {
    throw new InvariantViolationError(
      `学習が完了していないルールは適用できない: ${rule.common.merchantName}`,
    )
  }
  const expenseClass = rule.expenseClassRef.expenseClass
  if (expenseClass === 'business_expense' && rule.expenseTypeRef.kind !== 'learned') {
    throw new InvariantViolationError(
      `経費種別が未学習のため適用できない: ${rule.common.merchantName}`,
    )
  }
  return {
    categoryId: rule.categoryRef.categoryId,
    expenseClass,
    ...(expenseClass === 'business_expense' && rule.expenseTypeRef.kind === 'learned'
      ? { expenseTypeId: rule.expenseTypeRef.expenseTypeId }
      : {}),
  }
}

/** 状態遷移: 有効 → 学習無効化（M-1「この加盟店は学習しない」） */
export function disableMerchantLearning(
  rule: ActiveMerchantLearningRule,
  at: Date,
): DisabledMerchantLearningRule {
  return MerchantLearningRuleSchema.parse({
    kind: 'disabled',
    common: rule.common,
    disabledAt: at,
  }) as DisabledMerchantLearningRule
}

/**
 * X-1: 加盟店学習の対象外となる加盟店名（Amazon商品キー学習を使用）。
 * 上流の正規化（NFKC + 空白圧縮、OQ-23）は大文字小文字を畳まないため、
 * 表記ゆれをすり抜けさせないよう防御的に正規化して比較する。
 */
function isAmazonMerchant(merchantName: string): boolean {
  return merchantName.normalize('NFKC').trim().toUpperCase() === 'AMAZON.CO.JP'
}

/**
 * 修正後分類（08b §2「手動修正を学習に反映する」の入力）
 * 経費種別ID は費用区分が経費（business_expense）のときのみ意味を持つ。
 *
 * household-analysis の確定分類（ConfirmedClassification）を BC 境界で受け直す ACL 表現。
 * 不変条件（経費 ⇒ 経費種別ID 必須）は確定分類と同一で、弱い版を持たない。
 */
export const ManualClassificationSchema = z
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
        message: '経費（business_expense）の修正後分類には経費種別ID が必須',
        path: ['expenseTypeId'],
      })
    }
  })
export type ManualClassification = z.infer<typeof ManualClassificationSchema>

export type ReflectManualClassificationResult =
  | { kind: 'updated'; rule: ActiveMerchantLearningRule; updatedAxes: LearningAxis[] }
  | { kind: 'unchanged' }
  | { kind: 'skipped'; reason: 'amazon_merchant' | 'learning_disabled' }

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
 * 手動修正を学習に反映する（08b §2）
 *
 * - I-1: 即時反映（呼び出し側は保存ボタン押下のタイミングで呼ぶ）
 * - T-2: カテゴリ／費用区分／経費種別は軸独立。値が変わった軸のみ更新軸として報告する。
 *   費用区分が経費以外へ変わっても学習済み経費種別は保持する（軸独立のため触らない）
 * - F-1: 当該ユーザーのルールのみを入出力とする（検索は Repository 側で userId 必須）
 * - X-1: AMAZON.CO.JP は対象外（skipped: amazon_merchant）
 * - M-1: 学習無効化中の加盟店は学習しない（skipped: learning_disabled）
 */
export function reflectManualClassification(
  existing: MerchantLearningRule | null,
  userId: UserId,
  merchantName: string,
  classification: ManualClassification,
  at: Date,
): ReflectManualClassificationResult {
  if (isAmazonMerchant(merchantName)) {
    return { kind: 'skipped', reason: 'amazon_merchant' }
  }
  if (existing !== null && existing.kind === 'disabled') {
    return { kind: 'skipped', reason: 'learning_disabled' }
  }
  const input = ManualClassificationSchema.parse(classification)

  const baseCategoryRef: CategoryLearningRef = existing?.categoryRef ?? { kind: 'unlearned' }
  const baseExpenseClassRef: ExpenseClassLearningRef = existing?.expenseClassRef ?? {
    kind: 'unlearned',
  }
  const baseExpenseTypeRef: ExpenseTypeLearningRef = existing?.expenseTypeRef ?? {
    kind: 'unlearned',
  }

  const nextCategoryRef: CategoryLearningRef = { kind: 'learned', categoryId: input.categoryId }
  const nextExpenseClassRef: ExpenseClassLearningRef = {
    kind: 'learned',
    expenseClass: input.expenseClass,
  }
  // 経費以外への修正では経費種別軸を触らない（T-2 軸独立）
  const nextExpenseTypeRef: ExpenseTypeLearningRef =
    input.expenseClass === 'business_expense' && input.expenseTypeId !== undefined
      ? { kind: 'learned', expenseTypeId: input.expenseTypeId }
      : baseExpenseTypeRef

  const updatedAxes: LearningAxis[] = []
  if (!sameCategoryRef(baseCategoryRef, nextCategoryRef)) updatedAxes.push('category')
  if (!sameExpenseClassRef(baseExpenseClassRef, nextExpenseClassRef)) {
    updatedAxes.push('expense_class')
  }
  if (!sameExpenseTypeRef(baseExpenseTypeRef, nextExpenseTypeRef)) updatedAxes.push('expense_type')
  if (updatedAxes.length === 0) return { kind: 'unchanged' }

  const rule = MerchantLearningRuleSchema.parse({
    kind: 'active',
    common: { userId, merchantName },
    categoryRef: nextCategoryRef,
    expenseClassRef: nextExpenseClassRef,
    expenseTypeRef: nextExpenseTypeRef,
    lastUpdatedAt: at,
  }) as ActiveMerchantLearningRule
  return { kind: 'updated', rule, updatedAxes }
}

/** 状態遷移: 学習無効化 → 再有効化（再有効化直後は全軸未学習に戻る） */
export function reenableMerchantLearning(
  rule: DisabledMerchantLearningRule,
  at: Date,
): ActiveMerchantLearningRule {
  return MerchantLearningRuleSchema.parse({
    kind: 'active',
    common: rule.common,
    categoryRef: { kind: 'unlearned' },
    expenseClassRef: { kind: 'unlearned' },
    expenseTypeRef: { kind: 'unlearned' },
    lastUpdatedAt: at,
  }) as ActiveMerchantLearningRule
}
