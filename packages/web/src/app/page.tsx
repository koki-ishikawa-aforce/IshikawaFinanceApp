'use client'

import { useState } from 'react'
import type { DashboardMode, YearMonth } from '@warimaru/domain'
import { MonthNavigator } from '@/components/dashboard/MonthNavigator'
import { ModeToggle } from '@/components/dashboard/ModeToggle'
import { KpiGrid } from '@/components/dashboard/KpiGrid'
import { CategoryBreakdown } from '@/components/dashboard/CategoryBreakdown'
import { SpousePersonalNote } from '@/components/dashboard/SpousePersonalNote'
import { getCurrentMonth } from '@/lib/month'
import { useDashboardKpis } from '@/hooks/useDashboardKpis'
import { useCategoryBreakdown } from '@/hooks/useCategoryBreakdown'
import { describeRequestFailure } from '@/lib/api-client'
import { useTheme } from '@/theme/ThemeProvider'
import { getCategoryColors } from '@/theme/tokens'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

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

      {/*
        画面名の見出し(usability 8-5)。この画面は月ナビゲーションから始まり、
        タイトルの文字を出す場所が無い。見出しが無いと読み上げソフトで画面の構造を
        たどれないため、見た目は変えずに `<h1>` だけを置く。
        文言は下部ナビの項目名(`AppNav`)と揃える(同 5-1。「ダッシュボード」は
        利用者が目にしない呼び方なので使わない)
      */}
      <h1 className={ui.srOnly}>ホーム</h1>

      <MonthNavigator month={month} onMonthChange={setMonth} />
      <ModeToggle mode={mode} onModeChange={setMode} />

      {kpis.isLoading && <LoadingState />}
      {kpis.error && (
        <ErrorState onRetry={() => void kpis.refetch()} isRetrying={kpis.isFetching}>
          {describeRequestFailure(kpis.error, 'KPI の取得に失敗しました')}
        </ErrorState>
      )}
      {kpis.data && <KpiGrid kpis={kpis.data} />}

      {/*
        カテゴリ内訳だけカードと見出しの外に置くと、空状態の案内が背景の上に 1 行浮いて
        他画面と揃わない(#311 のレビュー指摘)。他画面のセクションと同じ器に載せる。
        器は取得状態によらず出す — 月・モードを切り替えるたびカードごと消えると、
        何のセクションが消えたのか分からなくなるため(usability 1-1)
      */}
      <div className={ui.card}>
        {/* 見た目は `.sectionTitle` のまま。`<h2>` にして見出しとしてもたどれるようにする(usability 8-5) */}
        <h2 className={ui.sectionTitle}>
          {mode === 'household' ? '世帯支出（カテゴリ別）' : '個人支出（カテゴリ別）'}
        </h2>
        {breakdown.isLoading && <LoadingState />}
        {breakdown.error && (
          <ErrorState onRetry={() => void breakdown.refetch()} isRetrying={breakdown.isFetching}>
            {describeRequestFailure(breakdown.error, 'カテゴリ内訳の取得に失敗しました')}
          </ErrorState>
        )}
        {breakdown.data && (
          <CategoryBreakdown data={breakdown.data} categoryColors={categoryColors} />
        )}
      </div>

      {mode === 'household' && kpis.data && (
        <SpousePersonalNote amount={kpis.data.spousePersonalTotal} theme={theme} />
      )}
    </main>
  )
}
