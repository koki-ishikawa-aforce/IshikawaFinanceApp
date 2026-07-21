'use client'

import { useState } from 'react'
import type { DashboardMode, YearMonth } from '@warimaru/domain'
import { MonthNavigator } from '@/components/dashboard/MonthNavigator'
import { ModeToggle } from '@/components/dashboard/ModeToggle'
import { KpiGrid } from '@/components/dashboard/KpiGrid'
import { CategoryBreakdown } from '@/components/dashboard/CategoryBreakdown'
import { useDashboardKpis } from '@/hooks/useDashboardKpis'
import { useCategoryBreakdown } from '@/hooks/useCategoryBreakdown'
import { useTheme } from '@/theme/ThemeProvider'
import { getCategoryColors, getDecorativeEmoji } from '@/theme/tokens'
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

  const emoji = getDecorativeEmoji(theme)
  const categoryColors = getCategoryColors(theme)

  return (
    <main className={styles.main}>
      <div className={styles.decorativeEmoji}>
        <span className={styles.emoji1}>{emoji[0]}</span>
        <span className={styles.emoji2}>{emoji[1]}</span>
        <span className={styles.emoji3}>{emoji[2]}</span>
      </div>

      <MonthNavigator month={month} onMonthChange={setMonth} />
      <ModeToggle mode={mode} onModeChange={setMode} />

      {kpis.isLoading && <div className={styles.loading}>読み込み中...</div>}
      {kpis.error && <div className={styles.error}>KPI の取得に失敗しました</div>}
      {kpis.data && <KpiGrid kpis={kpis.data} />}

      {breakdown.data && (
        <CategoryBreakdown data={breakdown.data} categoryColors={categoryColors} />
      )}
    </main>
  )
}
