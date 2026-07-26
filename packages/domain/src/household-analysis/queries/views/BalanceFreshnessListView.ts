/**
 * 残高鮮度評価リスト View（08c `data 残高鮮度評価リスト = List<残高鮮度評価>`）
 *
 * 残高鮮度は世帯共有（プライバシー3段階の「世帯フルオープン」）のため viewer で
 * 絞り込まない。残高・資産推移管理の口座残高一覧（`AccountBalanceListView`）と
 * 同じ「両者の active 口座」を対象とし、`accountId` で突き合わせられる。
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
