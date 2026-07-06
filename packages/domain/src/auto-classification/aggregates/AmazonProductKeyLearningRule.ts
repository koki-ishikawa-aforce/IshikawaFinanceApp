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
import { UserIdSchema } from '../../shared/ids'
import { AmazonProductKeySchema } from '../../shared/value-objects/AmazonProductKey'
import {
  CategoryLearningRefSchema,
  ExpenseClassLearningRefSchema,
  ExpenseTypeLearningRefSchema,
} from '../value-objects/LearningRefs'

export const AmazonProductKeyLearningRuleSchema = z.object({
  userId: UserIdSchema,
  amazonProductKey: AmazonProductKeySchema,
  categoryRef: CategoryLearningRefSchema,
  expenseClassRef: ExpenseClassLearningRefSchema,
  expenseTypeRef: ExpenseTypeLearningRefSchema,
  lastUpdatedAt: z.date(),
})
export type AmazonProductKeyLearningRule = z.infer<typeof AmazonProductKeyLearningRuleSchema>
