/**
 * Phase 3.5 ダッシュボード KPI 4 枚に対応
 * @see docs/domain/wireframes/README.md §1
 * @see docs/superpowers/specs/2026-05-01-phase3.5-ux-ui-design.md §6
 */
import { z } from 'zod'
import { MoneySchema } from '../../../shared/value-objects/Money'

export const DashboardKpisViewSchema = z.object({
  mode: z.enum(['household', 'personal']),
  /** 当月支出 */
  currentMonthSpending: MoneySchema,
  /** 貯蓄残高（SMBC + 別銀行貯蓄合算）— 残高・資産推移管理から借用 */
  savingsBalance: MoneySchema,
  /** NISA 積立原資（累計）— 残高・資産推移管理から借用 */
  nisaContributionAccumulated: MoneySchema,
  /** 資産合計 = 貯蓄残高 + NISA 積立原資 - 三井住友カード未払金 */
  totalAssets: MoneySchema,
})
export type DashboardKpisView = z.infer<typeof DashboardKpisViewSchema>
