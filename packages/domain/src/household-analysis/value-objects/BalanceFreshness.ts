/**
 * 残高鮮度評価（08c `behavior 残高鮮度を評価する`）
 *
 * 評価ロジックは家計分析が持ち、根拠データ（最終更新日時）は残高・資産推移管理から
 * 借用する（08d L244「最終更新日時のみを供給。鮮度しきい値の判定は家計分析側で行う」）。
 * 対象は別銀行貯蓄口座（`Account.kind = 'other_savings'`）の手入力残高のみで、
 * 他 3 種は自動更新のため鮮度評価の対象外（OQ-44）。
 *
 * @see docs/domain/08c-ul-家計分析.md L160-163 / L250-256
 * @see docs/domain/03-open-questions.md OQ-44
 */
import { z } from 'zod'
import { AccountIdSchema } from '../../shared/ids'

/**
 * 鮮度アラートの閾値（日数）。経過日数がこの値**以上**でアラートになる。
 *
 * 35 日の根拠（OQ-44、2026-07-24 確定）: 別銀行貯蓄残高の更新は毎月 5 日の
 * CSV 取込リマインダーに合わせた月次運用を想定しており、正常時の更新間隔は 28〜31 日。
 * 30 日では正常な月次サイクルの境界で毎月アラートが点灯する（フラッピング）ため、
 * 1 サイクル + 数日の猶予を取る。1 ヶ月飛ばした場合は約 60 日経過で確実に検知できる。
 *
 * この定数が閾値の単一ソース。プレゼンテーション層で閾値を再定義してはならない。
 */
export const BALANCE_FRESHNESS_THRESHOLD_DAYS = 35

/** 鮮度状態（08c `data 鮮度状態 = 鮮度OK OR 鮮度アラート`） */
export const BalanceFreshnessStatusSchema = z.enum(['ok', 'alert'])
export type BalanceFreshnessStatus = z.infer<typeof BalanceFreshnessStatusSchema>

/** 残高鮮度評価（08c `data 残高鮮度評価 = 口座ID AND 最終更新日時 AND 経過日数 AND 鮮度状態`） */
export const BalanceFreshnessSchema = z.object({
  accountId: AccountIdSchema,
  lastUpdatedAt: z.date(),
  daysSinceLastUpdate: z.number().int().nonnegative(),
  status: BalanceFreshnessStatusSchema,
})
export type BalanceFreshness = z.infer<typeof BalanceFreshnessSchema>

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * 経過日数を丸 1 日単位で数える。
 *
 * 最終更新が未来日時（クロックずれ・手入力）の場合は 0 に切り上げる
 * （負の経過日数は「まだ更新されていない日数」として意味を持たないため）。
 */
function daysBetween(lastUpdatedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - lastUpdatedAt.getTime()) / MS_PER_DAY))
}

/**
 * 残高鮮度を評価する（08c `behavior 残高鮮度を評価する`）。
 *
 * 事前: `accountId` / `lastUpdatedAt` は残高・資産推移管理から借用した値
 * 事後: 経過日数が {@link BALANCE_FRESHNESS_THRESHOLD_DAYS} 以上なら `status = 'alert'`
 */
export function evaluateBalanceFreshness(input: {
  accountId: BalanceFreshness['accountId']
  lastUpdatedAt: Date
  now: Date
}): BalanceFreshness {
  const daysSinceLastUpdate = daysBetween(input.lastUpdatedAt, input.now)
  return BalanceFreshnessSchema.parse({
    accountId: input.accountId,
    lastUpdatedAt: input.lastUpdatedAt,
    daysSinceLastUpdate,
    status: daysSinceLastUpdate >= BALANCE_FRESHNESS_THRESHOLD_DAYS ? 'alert' : 'ok',
  })
}
