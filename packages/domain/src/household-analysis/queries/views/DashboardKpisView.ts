/**
 * Phase 3.5 ダッシュボード KPI 4 枚に対応
 * @see docs/domain/wireframes/README.md §1
 * @see docs/superpowers/specs/2026-05-01-phase3.5-ux-ui-design.md §6
 */
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'

export const DashboardKpisViewSchema = z.object({
  mode: z.enum(['household', 'personal']),
  /** 当月支出（世帯モード=世帯合計 / 個人モード=本人の個人合計） */
  currentMonthSpending: MoneySchema,
  /**
   * 当月の配偶者の個人合計（08c L147「個人合計(配偶者)」）。
   * 個人費用は「相手には合計のみ可視」（01-overview.md L153-155）のため、
   * 明細ではなく合計値としてのみ提供する。経費(会社)合計は本人のみ可視のため
   * ここには含めない（プライバシールール 3）。
   */
  spousePersonalTotal: MoneySchema,
  /** 貯蓄残高（SMBC + 別銀行貯蓄合算）— 残高・資産推移管理から借用 */
  savingsBalance: MoneySchema,
  /** NISA 積立原資（累計）— 残高・資産推移管理から借用 */
  nisaContributionAccumulated: MoneySchema,
  /** 資産合計 = 貯蓄残高 + NISA 積立原資 - 三井住友カード未払金 */
  totalAssets: MoneySchema,
})
export type DashboardKpisView = z.infer<typeof DashboardKpisViewSchema>
