'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  AccountBalanceListWireSchema,
  AssetTotalWireSchema,
  BalanceTimeSeriesWireSchema,
  type AccountBalanceItemWire,
} from '@/lib/api-schemas'
import { formatMoney } from '@/lib/format'
import { formatDateTime, getCurrentMonth, shiftMonth } from '@/lib/month'
import { TimeSeriesChart, type ChartSeries } from '@/components/balances/TimeSeriesChart'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

const RANGE_OPTIONS = [
  { months: 6, label: '6ヶ月' },
  { months: 12, label: '1年' },
  { months: 24, label: '2年' },
] as const

function BalanceItem({ item }: { item: AccountBalanceItemWire }) {
  switch (item.kind) {
    case 'smbc_bank':
      return (
        <div className={styles.balanceItem}>
          <div className={styles.balanceHead}>
            <span className={styles.balanceIcon}>🏦</span>
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
            <span className={styles.balanceIcon}>💳</span>
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
            <span className={styles.balanceIcon}>🐖</span>
            <span className={styles.balanceName}>{item.displayName}</span>
            {item.daysSinceLastUpdate >= 30 && (
              <span className={styles.staleTag}>{item.daysSinceLastUpdate}日未更新</span>
            )}
          </div>
          <span className={styles.balanceValue}>{formatMoney(item.currentBalance)}</span>
          <span className={styles.balanceMeta}>更新: {formatDateTime(item.lastUpdatedAt)}</span>
        </div>
      )
    case 'nisa':
      return (
        <div className={styles.balanceItem}>
          <div className={styles.balanceHead}>
            <span className={styles.balanceIcon}>📈</span>
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
      {totalQuery.error && <div className={ui.error}>資産合計の取得に失敗しました</div>}

      <div className={ui.card}>
        <span className={ui.sectionTitle}>口座残高</span>
        {listQuery.isLoading && <div className={ui.loading}>読み込み中...</div>}
        {listQuery.error && <div className={ui.error}>残高一覧の取得に失敗しました</div>}
        {listQuery.data &&
          (listQuery.data.items.length === 0 ? (
            <div className={ui.empty}>登録されている口座がありません</div>
          ) : (
            <div className={styles.balanceList}>
              {listQuery.data.items.map(item => (
                <BalanceItem key={item.accountId} item={item} />
              ))}
            </div>
          ))}
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
        {seriesQuery.isLoading && <div className={ui.loading}>読み込み中...</div>}
        {seriesQuery.error && <div className={ui.error}>資産推移の取得に失敗しました</div>}
        {seriesQuery.data && <TimeSeriesChart series={chartSeries} />}
      </div>
    </main>
  )
}
