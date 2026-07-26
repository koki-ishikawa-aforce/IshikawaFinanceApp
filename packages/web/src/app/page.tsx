'use client'

import { useState } from 'react'
import type { DashboardMode, YearMonth } from '@warimaru/domain'
import { MonthNavigator } from '@/components/dashboard/MonthNavigator'
import { ModeToggle } from '@/components/dashboard/ModeToggle'
import { KpiGrid } from '@/components/dashboard/KpiGrid'
import { CategoryBreakdown } from '@/components/dashboard/CategoryBreakdown'
import { SpousePersonalNote } from '@/components/dashboard/SpousePersonalNote'
import { useDashboardKpis } from '@/hooks/useDashboardKpis'
import { useCategoryBreakdown } from '@/hooks/useCategoryBreakdown'
import { useTheme } from '@/theme/ThemeProvider'
import { getCategoryColors } from '@/theme/tokens'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

function getCurrentMonth(): YearMonth {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}` as YearMonth
}

export default function DashboardPage() {
  const [month, setMonth] = useState<YearMonth>(getCurrentMonth)
  const [mode, setMode] = useState<DashboardMode>('household')
  const theme = useTheme()

  const kpis = useDashboardKpis(month, mode)
  const breakdown = useCategoryBreakdown(month, mode)

  const categoryColors = getCategoryColors(theme)

  return (
    <main className={styles.main}>
      <div className={styles.decorations} aria-hidden="true" />

      <MonthNavigator month={month} onMonthChange={setMonth} />
      <ModeToggle mode={mode} onModeChange={setMode} />

      {kpis.isLoading && <div className={styles.loading}>読み込み中...</div>}
      {kpis.error && <div className={styles.error}>KPI の取得に失敗しました</div>}
      {kpis.data && <KpiGrid kpis={kpis.data} />}

      {/*
        カテゴリ内訳だけカードと見出しの外に置くと、空状態の案内が背景の上に 1 行浮いて
        他画面と揃わない(#311 のレビュー指摘)。他画面のセクションと同じ器に載せる
      */}
      {breakdown.data && (
        <div className={ui.card}>
          <span className={ui.sectionTitle}>カテゴリ別支出</span>
          <CategoryBreakdown data={breakdown.data} categoryColors={categoryColors} />
        </div>
      )}

      {mode === 'household' && kpis.data && (
        <SpousePersonalNote amount={kpis.data.spousePersonalTotal} theme={theme} />
      )}
    </main>
  )
}
