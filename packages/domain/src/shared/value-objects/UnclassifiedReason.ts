/**
 * 未分類理由 enum
 * @see docs/domain/08b-ul-自動分類学習.md §1
 * @see docs/domain/08c-ul-家計分析.md §1
 *
 * kawasima: data 未分類理由 = 加盟店ルール未学習 OR Amazon商品キー未学習 OR
 *   Amazon商品情報判定不能 OR Amazon突合タイムアウト OR 学習無効化適用
 *
 * 自動分類・学習（分類結果の生成側）と家計分析（未分類取引の保持側）の共有カーネル語彙。
 * Phase 5 M-A で household-analysis から shared へ移設（エクスポート名は不変）。
 */
import { z } from 'zod'

export const UnclassifiedReasonSchema = z.enum([
  'merchant_rule_unlearned',
  'amazon_product_key_unlearned',
  'amazon_product_info_undecidable',
  'amazon_match_timeout',
  'learning_disabled',
])
export type UnclassifiedReason = z.infer<typeof UnclassifiedReasonSchema>
