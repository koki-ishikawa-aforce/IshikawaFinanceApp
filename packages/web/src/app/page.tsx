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
import { useSpouseProfile } from '@/hooks/useSpouseProfile'
import { useViewerRole } from '@/hooks/useViewerRole'
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
  const spouseProfile = useSpouseProfile()
  // 相手の個人費行の名前は「確定した役割」に限る。テーマ（useTheme）は取得前 darling に
  // 倒れるため、名前の根拠には使わない（usability.md 7-2。balances/page.tsx と同じ理由）
  const viewerRoleQuery = useViewerRole()

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

      {/*
        KPI もカテゴリ内訳と同じ器(白いカード + 見出し)に載せる。読み込み中・失敗の
        表示だけが背景に直接浮くと他画面と揃わない(#584)。器は取得状態によらず出す —
        月・モードを切り替えるたびカードごと消えると、何のセクションが消えたのか
        分からなくなるため(usability 1-1)
      */}
      <div className={ui.card}>
        <h2 className={ui.sectionTitle}>今月の状況</h2>
        {kpis.isLoading && <LoadingState />}
        {kpis.error && (
          <ErrorState onRetry={() => void kpis.refetch()} isRetrying={kpis.isFetching}>
            {describeRequestFailure(kpis.error, 'KPI の取得に失敗しました')}
          </ErrorState>
        )}
        {kpis.data && <KpiGrid kpis={kpis.data} />}
      </div>

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

      {mode === 'household' &&
        kpis.data &&
        (viewerRoleQuery.isPending ? (
          // 役割が確定するまでロール名で仮描画しない(usability 7-2)。通常の読み込み中は
          // まだ失敗していないので、次のエラー分岐とは分けて先に判定する
          <LoadingState />
        ) : viewerRoleQuery.data === undefined ? (
          // 誰の金額かを言えないまま出すと相手を取り違えるため、金額ごと出さない(usability 7-2)
          <ErrorState
            onRetry={() => void viewerRoleQuery.refetch()}
            isRetrying={viewerRoleQuery.isFetching}
          >
            {describeRequestFailure(
              viewerRoleQuery.error,
              '相手の個人費の合計は表示できませんでした',
            )}
          </ErrorState>
        ) : spouseProfile.isPending ? (
          // ニックネーム未取得のうちはロール名で仮描画せず、取得完了後に一度で確定させる
          // （balances/page.tsx の SpouseSharedTotalItem と同じ理由。usability 7-2）
          <LoadingState />
        ) : (
          <SpousePersonalNote
            amount={kpis.data.spousePersonalTotal}
            theme={viewerRoleQuery.data.role}
            partnerNickname={spouseProfile.data?.profile.nickname ?? null}
          />
        ))}
    </main>
  )
}
