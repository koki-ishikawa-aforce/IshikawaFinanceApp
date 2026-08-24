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
      {/*
        資産に関わる 3 つは残高・資産推移の画面へ入る（spec §5.5 ⑤⑥⑦）。行き先を口座詳細に
        直結させないのは、ここに出ている金額が世帯 2 人分の合計で、口座 1 件を指していないため
        （どちらの口座の話かを画面が決めてしまうと、出ている数字と中身がずれる）。
        残高一覧で口座を選べば、その口座の詳細（#406）へ続く
      */}
      <KpiCard label="貯蓄残高" value={kpis.savingsBalance} href="/balances" />
      <KpiCard label="NISA積立累計" value={kpis.nisaContributionAccumulated} href="/balances" />
      <KpiCard label="資産合計" value={kpis.totalAssets} isHero href="/balances" />
    </div>
  )
}
