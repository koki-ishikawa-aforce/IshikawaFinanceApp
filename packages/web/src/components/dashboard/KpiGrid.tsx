import type { DashboardKpisView } from '@warimaru/domain'
import { KpiCard } from './KpiCard'
import styles from './KpiGrid.module.css'

interface KpiGridProps {
  kpis: DashboardKpisView
}

export function KpiGrid({ kpis }: KpiGridProps) {
  return (
    <div className={styles.grid}>
      <KpiCard label="今月支出" value={kpis.currentMonthSpending} />
      <KpiCard label="貯蓄残高" value={kpis.savingsBalance} />
      <KpiCard label="NISA積立累計" value={kpis.nisaContributionAccumulated} />
      <KpiCard label="総資産" value={kpis.totalAssets} isHero />
    </div>
  )
}
