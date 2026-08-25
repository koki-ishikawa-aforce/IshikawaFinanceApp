/**
 * 残高鮮度評価リスト View（08c `data 残高鮮度評価リスト = List<残高鮮度評価>`）
 *
 * 残高は本人のみ可視（プライバシー3段階の「個人は相手に非公開」P2-B5 / AT-404）のため、
 * `DashboardQuery.fetchBalanceFreshness` は viewer で本人所有の active 口座に絞り込む。
 * 配偶者の口座は件数も含めて返さない。`accountId` は残高・資産推移管理の口座残高一覧
 * （`AccountBalanceListView`）の本人分と突き合わせられる。
 *
 * `displayName` は画面で口座を識別するための表示名で、残高一覧の同名項目と一致する。
 */
import { z } from 'zod'
import { BalanceFreshnessSchema } from '../../value-objects/BalanceFreshness'

export const BalanceFreshnessItemSchema = BalanceFreshnessSchema.extend({
  displayName: z.string(),
})
export type BalanceFreshnessItem = z.infer<typeof BalanceFreshnessItemSchema>

export const BalanceFreshnessListViewSchema = z.object({
  items: z.array(BalanceFreshnessItemSchema),
})
export type BalanceFreshnessListView = z.infer<typeof BalanceFreshnessListViewSchema>
