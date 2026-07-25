/**
 * Amazon商品キー学習ルール集約（自動分類・学習コンテキスト）
 * @see docs/domain/08b-ul-自動分類学習.md §1
 * @see docs/domain/09-aggregates.md #5
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.1
 *
 * kawasima: data Amazon商品キー学習ルール = ユーザーID AND Amazon商品キー
 *   AND カテゴリ参照 AND 費用区分参照 AND 経費種別参照 AND 最終更新日時
 *
 * 不変条件:
 *  - F-1: ユーザーID + Amazon商品キーで一意（Repository 検索で保証、Phase 5 M-B）
 *  - T-2: カテゴリ・費用区分・経費種別を独立した参照として保持
 *
 * X-1 特例: 加盟店名「AMAZON.CO.JP」の取引はこちらのルールで学習する。
 * 専用 ID は持たない（自然キー = userId + amazonProductKey、09-aggregates.md #5）。
 */
import { z } from 'zod'
import { UserIdSchema, type UserId } from '../../shared/ids'
import {
  AmazonProductKeySchema,
  type AmazonProductKey,
} from '../../shared/value-objects/AmazonProductKey'
import {
  CategoryLearningRefSchema,
  ExpenseClassLearningRefSchema,
  ExpenseTypeLearningRefSchema,
  applicableClassificationFromRefs,
  deriveLearnedRefs,
  type LearningRefs,
} from '../value-objects/LearningRefs'
import type { LearningAxis } from '../value-objects/LearningAxis'
import {
  ManualClassificationSchema,
  type ManualClassification,
} from '../value-objects/ManualClassification'

export const AmazonProductKeyLearningRuleSchema = z.object({
  userId: UserIdSchema,
  amazonProductKey: AmazonProductKeySchema,
  categoryRef: CategoryLearningRefSchema,
  expenseClassRef: ExpenseClassLearningRefSchema,
  expenseTypeRef: ExpenseTypeLearningRefSchema,
  lastUpdatedAt: z.date(),
})
export type AmazonProductKeyLearningRule = z.infer<typeof AmazonProductKeyLearningRuleSchema>

export type ReflectAmazonProductKeyClassificationResult =
  | { kind: 'updated'; rule: AmazonProductKeyLearningRule; updatedAxes: LearningAxis[] }
  | { kind: 'unchanged' }

/**
 * Amazon 商品キーの手動修正を学習に反映する（08b §2「手動修正を学習に反映する」の X-1 版）
 *
 * 加盟店学習（`reflectManualClassification`）の Amazon 商品キー版。加盟店学習と違い
 * 学習無効化（M-1）・AMAZON.CO.JP 拒否は無い（本ルール自体が AMAZON.CO.JP の学習の受け皿）。
 *  - I-1: 即時反映（呼び出し側は確定のタイミングで呼ぶ）
 *  - T-2: カテゴリ／費用区分／経費種別は軸独立。値が変わった軸のみ更新軸として報告する
 *  - F-1: 当該ユーザー + 商品キーのルールのみを入出力とする（検索は Repository 側で userId 必須）
 *  - 冪等: 値が変わらなければ `unchanged`（同一イベント再配信で二重付け替えしない）
 */
export function reflectAmazonProductKeyManualClassification(
  existing: AmazonProductKeyLearningRule | null,
  userId: UserId,
  amazonProductKey: AmazonProductKey,
  classification: ManualClassification,
  at: Date,
): ReflectAmazonProductKeyClassificationResult {
  const input = ManualClassificationSchema.parse(classification)
  const base: LearningRefs = {
    categoryRef: existing?.categoryRef ?? { kind: 'unlearned' },
    expenseClassRef: existing?.expenseClassRef ?? { kind: 'unlearned' },
    expenseTypeRef: existing?.expenseTypeRef ?? { kind: 'unlearned' },
  }
  const { categoryRef, expenseClassRef, expenseTypeRef, updatedAxes } = deriveLearnedRefs(
    base,
    input,
  )
  if (updatedAxes.length === 0) return { kind: 'unchanged' }

  const rule = AmazonProductKeyLearningRuleSchema.parse({
    userId,
    amazonProductKey,
    categoryRef,
    expenseClassRef,
    expenseTypeRef,
    lastUpdatedAt: at,
  })
  return { kind: 'updated', rule, updatedAxes }
}

/**
 * 学習済み Amazon 商品キールールから適用可能な分類を導出する（T-2、未学習軸が残れば適用不可）。
 * 「取引候補をAmazon商品キーで分類する」（08b §2）でルールを取引へ当てる際の判定ポイント。
 */
export function applicableAmazonProductKeyClassification(
  rule: AmazonProductKeyLearningRule,
): ManualClassification {
  return ManualClassificationSchema.parse(
    applicableClassificationFromRefs(rule, rule.amazonProductKey),
  )
}
