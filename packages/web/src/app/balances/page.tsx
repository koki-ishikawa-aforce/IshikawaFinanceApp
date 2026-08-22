'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  AccountBalanceListWireSchema,
  AssetTotalWireSchema,
  BalanceTimeSeriesWireSchema,
  type AccountBalanceItemWire,
  type BalanceFreshnessItemWire,
} from '@/lib/api-schemas'
import { formatMoney } from '@/lib/format'
import { formatDateTime, getCurrentMonth, shiftMonth } from '@/lib/month'
import { TimeSeriesChart, type ChartSeries } from '@/components/balances/TimeSeriesChart'
import { FreshnessBadge, useBalanceFreshnessQuery } from '@/components/balances/BalanceFreshness'
import { LuLandmark, LuCreditCard, LuPiggyBank, LuTrendingUp } from '@/components/ui/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorState } from '@/components/ui/ErrorState'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

const RANGE_OPTIONS = [
  { months: 6, label: '6ヶ月' },
  { months: 12, label: '1年' },
  { months: 24, label: '2年' },
] as const

function BalanceItem({
  item,
  freshness,
}: {
  item: AccountBalanceItemWire
  freshness?: BalanceFreshnessItemWire
}) {
  switch (item.kind) {
    case 'smbc_bank':
      return (
        <div className={styles.balanceItem}>
          <div className={styles.balanceHead}>
            <LuLandmark className={`${ui.iconSm} ${styles.balanceIcon}`} aria-hidden="true" />
            <span className={styles.balanceName}>{item.displayName}</span>
          </div>
          <span className={styles.balanceValue}>{formatMoney(item.currentBalance)}</span>
          <span className={styles.balanceMeta}>更新: {formatDateTime(item.lastUpdatedAt)}</span>
        </div>
      )
    case 'mitsui_sumitomo_card':
      return (
        <div className={styles.balanceItem}>
          <div className={styles.balanceHead}>
            <LuCreditCard className={`${ui.iconSm} ${styles.balanceIcon}`} aria-hidden="true" />
            <span className={styles.balanceName}>{item.displayName}</span>
          </div>
          <span className={`${styles.balanceValue} ${styles.negative}`}>
            -{formatMoney(item.currentMonthUnpaidTotal)}
          </span>
          <span className={styles.balanceMeta}>
            当月未払い
            {item.lastSettledAt !== null && ` ・ 前回精算: ${formatDateTime(item.lastSettledAt)}`}
          </span>
        </div>
      )
    case 'other_savings':
      return (
        <div className={styles.balanceItem}>
          <div className={styles.balanceHead}>
            <LuPiggyBank className={`${ui.iconSm} ${styles.balanceIcon}`} aria-hidden="true" />
            <span className={styles.balanceName}>{item.displayName}</span>
            <FreshnessBadge freshness={freshness} />
          </div>
          <span className={styles.balanceValue}>{formatMoney(item.currentBalance)}</span>
          <span className={styles.balanceMeta}>更新: {formatDateTime(item.lastUpdatedAt)}</span>
        </div>
      )
    case 'nisa':
      return (
        <div className={styles.balanceItem}>
          <div className={styles.balanceHead}>
            <LuTrendingUp className={`${ui.iconSm} ${styles.balanceIcon}`} aria-hidden="true" />
            <span className={styles.balanceName}>{item.displayName}</span>
          </div>
          <span className={styles.balanceValue}>{formatMoney(item.currentAccumulated)}</span>
          <span className={styles.balanceMeta}>
            積立累計 ・ 更新: {formatDateTime(item.lastUpdatedAt)}
          </span>
        </div>
      )
  }
}

export default function BalancesPage() {
  const [rangeMonths, setRangeMonths] = useState<number>(6)

  const listQuery = useQuery({
    queryKey: ['balances', 'list'],
    queryFn: () => apiFetch('/api/balances', AccountBalanceListWireSchema),
  })

  const totalQuery = useQuery({
    queryKey: ['balances', 'total'],
    queryFn: () => apiFetch('/api/balances/total', AssetTotalWireSchema),
  })

  // 鮮度の判定（閾値 35 日 = OQ-44）は家計分析の Query 側で行われる
  const freshnessQuery = useBalanceFreshnessQuery()
  const freshnessByAccountId = new Map(
    (freshnessQuery.data?.items ?? []).map(item => [item.accountId, item]),
  )
  // 一覧だけ先に描くと「未更新タグが後から生える」ちらつきになるため、
  // 鮮度が確定（成功・失敗いずれか）するまで口座行を描かない
  const balanceListReady = listQuery.data !== undefined && !freshnessQuery.isPending

  const to = getCurrentMonth()
  const from = shiftMonth(to, -(rangeMonths - 1))
  const seriesQuery = useQuery({
    queryKey: ['balances', 'time-series', from, to],
    queryFn: () =>
      apiFetch(`/api/balances/time-series?from=${from}&to=${to}`, BalanceTimeSeriesWireSchema),
  })

  const chartSeries: ChartSeries[] = seriesQuery.data
    ? [
        { label: 'SMBC', cssColorVar: '--cat-housing', points: seriesQuery.data.smbc },
        {
          label: 'その他貯蓄',
          cssColorVar: '--cat-food',
          points: seriesQuery.data.otherSavings,
        },
        {
          label: 'NISA積立',
          cssColorVar: '--cat-entertainment',
          points: seriesQuery.data.nisaContribution,
        },
        {
          label: 'カード未払い',
          cssColorVar: '--cat-other',
          points: seriesQuery.data.cardUnpaid,
        },
      ]
    : []

  return (
    <main className={styles.main}>
      <h1 className={ui.pageTitle}>口座残高・資産推移</h1>

      {totalQuery.data && (
        <div className={styles.heroCard}>
          <span className={styles.heroLabel}>総資産</span>
          <span className={styles.heroValue}>{formatMoney(totalQuery.data.total)}</span>
          <div className={styles.heroBreakdown}>
            <span>SMBC {formatMoney(totalQuery.data.smbcBalance)}</span>
            <span>貯蓄 {formatMoney(totalQuery.data.otherSavingsBalance)}</span>
            <span>NISA {formatMoney(totalQuery.data.nisaContributionAccumulated)}</span>
            <span>未払い -{formatMoney(totalQuery.data.cardUnpaidTotal)}</span>
          </div>
        </div>
      )}
      {totalQuery.error && <ErrorState>資産合計の取得に失敗しました</ErrorState>}

      <div className={ui.card}>
        <span className={ui.sectionTitle}>口座残高</span>
        {/* 読み込み中 → 一覧 / 空 / エラー に入れ替わる領域（docs/design/usability.md 8-4）。
            入れ替わる側は announce={false} で live region の入れ子を避ける。
            器が status のため、この中のエラーは alert ではなく polite で通知される
            （器を alert にすると読み込み中まで割り込むため、こちらを採る） */}
        <div role="status">
          {(listQuery.isLoading || (listQuery.data !== undefined && !balanceListReady)) && (
            <LoadingState announce={false} />
          )}
          {listQuery.error && (
            <ErrorState announce={false}>残高一覧の取得に失敗しました</ErrorState>
          )}
          {freshnessQuery.isError && (
            <>
              <ErrorState announce={false}>
                残高の更新状況を取得できませんでした（未更新のお知らせは出ません）
              </ErrorState>
              <button
                type="button"
                className={ui.buttonGhost}
                onClick={() => void freshnessQuery.refetch()}
              >
                再読み込み
              </button>
            </>
          )}
          {balanceListReady &&
            (listQuery.data.items.length === 0 ? (
              <EmptyState announce={false}>登録されている口座がありません</EmptyState>
            ) : (
              <div className={styles.balanceList}>
                {listQuery.data.items.map(item => (
                  <BalanceItem
                    key={item.accountId}
                    item={item}
                    freshness={freshnessByAccountId.get(item.accountId)}
                  />
                ))}
              </div>
            ))}
        </div>
      </div>

      <div className={ui.card}>
        <div className={ui.rowBetween}>
          <span className={ui.sectionTitle}>資産推移</span>
          <div className={styles.rangeToggle}>
            {RANGE_OPTIONS.map(option => (
              <button
                key={option.months}
                className={
                  rangeMonths === option.months
                    ? `${styles.rangeButton} ${styles.rangeActive}`
                    : styles.rangeButton
                }
                onClick={() => setRangeMonths(option.months)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {seriesQuery.isLoading && <LoadingState />}
        {seriesQuery.error && <ErrorState>資産推移の取得に失敗しました</ErrorState>}
        {seriesQuery.data && <TimeSeriesChart series={chartSeries} />}
      </div>
    </main>
  )
}
