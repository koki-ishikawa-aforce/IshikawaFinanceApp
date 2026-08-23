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
 *  - 加盟店名「AMAZON.CO.JP」は加盟店学習の対象外。代わりの学習経路だった X-1 Amazon商品キー学習は
 *    取り下げ済み（#572）のため、現状 Amazon の取引はどこにも学習されない。この扱いを続けるか
 *    通常の加盟店学習に戻すかは判断待ち（OQ-18 改訂 / #391）
 *
 * 専用 ID は持たない（自然キー = userId + merchantName、09-aggregates.md #4）。
 */
import { z } from 'zod'
import { UserIdSchema, type UserId } from '../../shared/ids'
import {
  CategoryLearningRefSchema,
  ExpenseClassLearningRefSchema,
  ExpenseTypeLearningRefSchema,
  applicableClassificationFromRefs,
  deriveLearnedRefs,
  type LearningRefs,
} from '../value-objects/LearningRefs'
import {
  ManualClassificationSchema,
  type ManualClassification,
} from '../value-objects/ManualClassification'
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
        message: 'AMAZON.CO.JP は加盟店学習の対象外（X-1 の商品キー学習は取り下げ済み、#572）',
        path: ['common', 'merchantName'],
      })
    }
  })
export type MerchantLearningRule = z.infer<typeof MerchantLearningRuleSchema>

export type ActiveMerchantLearningRule = Extract<MerchantLearningRule, { kind: 'active' }>
export type DisabledMerchantLearningRule = Extract<MerchantLearningRule, { kind: 'disabled' }>

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
 * 加盟店学習の対象外となる加盟店名（X-1 の名残。代わりの学習経路は #572 で取り下げ済み）。
 * 上流の正規化（NFKC + 空白圧縮、OQ-23）は大文字小文字を畳まないため、
 * 表記ゆれをすり抜けさせないよう防御的に正規化して比較する。
 */
function isAmazonMerchant(merchantName: string): boolean {
  return merchantName.normalize('NFKC').trim().toUpperCase() === 'AMAZON.CO.JP'
}

/**
 * 学習済みの3軸（カテゴリ・費用区分・経費種別）から適用可能な分類を導出する。
 *
 * 遡及適用・自動分類でルールを取引へ適用する際の唯一の判定ポイント。
 * 未学習軸が残るルールは適用できない不変条件（08b §2 T-2）を domain 側に
 * 一元化し、api / adapters 層で再実装しない（CLAUDE.md）。
 *  - カテゴリ・費用区分のいずれかが未学習 → 適用不可
 *  - 経費(会社) かつ経費種別が未学習 → 適用不可（経費は経費種別まで学習が必要）
 */
export function applicableClassification(rule: ActiveMerchantLearningRule): ManualClassification {
  return ManualClassificationSchema.parse(
    applicableClassificationFromRefs(rule, rule.common.merchantName),
  )
}

export type ReflectManualClassificationResult =
  | { kind: 'updated'; rule: ActiveMerchantLearningRule; updatedAxes: LearningAxis[] }
  | { kind: 'unchanged' }
  | { kind: 'skipped'; reason: 'amazon_merchant' | 'learning_disabled' }

/**
 * 手動修正を学習に反映する（08b §2）
 *
 * - I-1: 即時反映（呼び出し側は保存ボタン押下のタイミングで呼ぶ）
 * - T-2: カテゴリ／費用区分／経費種別は軸独立。値が変わった軸のみ更新軸として報告する。
 *   費用区分が経費以外へ変わっても学習済み経費種別は保持する（軸独立のため触らない）
 * - F-1: 当該ユーザーのルールのみを入出力とする（検索は Repository 側で userId 必須）
 * - AMAZON.CO.JP は対象外（skipped: amazon_merchant）。X-1 の商品キー学習取り下げ（#572）後も
 *   この除外は残しているため、Amazon の取引は学習されない（OQ-18 改訂で見直し予定 / #391）
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

  const base: LearningRefs = {
    categoryRef: existing?.categoryRef ?? { kind: 'unlearned' },
    expenseClassRef: existing?.expenseClassRef ?? { kind: 'unlearned' },
    expenseTypeRef: existing?.expenseTypeRef ?? { kind: 'unlearned' },
  }
  // T-2 軸独立で反映（経費以外への修正では経費種別軸を触らない）。共通ヘルパに一元化
  const { categoryRef, expenseClassRef, expenseTypeRef, updatedAxes } = deriveLearnedRefs(
    base,
    input,
  )
  if (updatedAxes.length === 0) return { kind: 'unchanged' }

  const rule = MerchantLearningRuleSchema.parse({
    kind: 'active',
    common: { userId, merchantName },
    categoryRef,
    expenseClassRef,
    expenseTypeRef,
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
