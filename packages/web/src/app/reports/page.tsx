'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { YearMonth } from '@warimaru/domain'
import { MonthNavigator } from '@/components/dashboard/MonthNavigator'
import { apiFetch, ApiError } from '@/lib/api-client'
import {
  CategoryListWireSchema,
  MonthlyReportViewWireSchema,
  type MonthlyReportViewWire,
} from '@/lib/api-schemas'
import { formatMoney } from '@/lib/format'
import { formatDateTime, getCurrentMonth } from '@/lib/month'
import { LuTriangleAlert } from '@/components/ui/icons'
import ui from '@/components/ui/common.module.css'
import styles from './page.module.css'

/** 対象月のレポート未作成（404）は「なし」として扱う */
async function fetchReport(month: YearMonth): Promise<MonthlyReportViewWire | null> {
  try {
    return await apiFetch(`/api/monthly-reports?month=${month}`, MonthlyReportViewWireSchema)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return null
    }
    throw e
  }
}

const TRANSFER_TARGET_LABELS = {
  personal_honey: '個人(Honey)',
  personal_darling: '個人(Darling)',
} as const

function ReportDetail({ report }: { report: MonthlyReportViewWire }) {
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/api/categories', CategoryListWireSchema),
    staleTime: 60_000,
  })
  const categoryNames = new Map(
    (categoriesQuery.data?.items ?? []).map(category => [category.categoryId, category.name]),
  )

  const householdTotal = report.common.householdCategoryTotals.reduce(
    (sum, item) => sum + item.total,
    0,
  )
  const finalized = report.status === 'finalized'

  return (
    <>
      <div className={ui.card}>
        <div className={ui.rowBetween}>
          <span className={ui.sectionTitle}>ステータス</span>
          <span className={finalized ? ui.badgeAccent : ui.badge}>
            {finalized ? '確定済み' : 'CSV確認済み'}
          </span>
        </div>
        <div className={styles.statusDates}>
          <span>CSV確認: {formatDateTime(report.csvConfirmedAt)}</span>
          {report.finalizedAt !== null && <span>確定: {formatDateTime(report.finalizedAt)}</span>}
          {report.common.isIncompleteMonth === true && (
            <span className={styles.incomplete}>
              <LuTriangleAlert aria-hidden="true" className={styles.incompleteIcon} />
              データが不完全な月です
            </span>
          )}
        </div>
      </div>

      <div className={ui.card}>
        <span className={ui.sectionTitle}>世帯支出（カテゴリ別）</span>
        {report.common.householdCategoryTotals.length === 0 ? (
          <div className={ui.empty}>世帯支出はありません</div>
        ) : (
          <ul className={styles.totalsList}>
            {report.common.householdCategoryTotals.map(item => (
              <li key={item.categoryId} className={ui.rowBetween}>
                <span className={styles.totalsLabel}>
                  {categoryNames.get(item.categoryId) ?? item.categoryId}
                </span>
                <span className={styles.totalsValue}>{formatMoney(item.total)}</span>
              </li>
            ))}
            <li className={`${ui.rowBetween} ${styles.totalsSum}`}>
              <span>合計</span>
              <span>{formatMoney(householdTotal)}</span>
            </li>
          </ul>
        )}
      </div>

      <div className={ui.card}>
        <span className={ui.sectionTitle}>個人・経費</span>
        <ul className={styles.totalsList}>
          <li className={ui.rowBetween}>
            <span className={styles.totalsLabel}>個人(Honey)</span>
            <span className={styles.totalsValue}>
              {formatMoney(report.common.personalTotalHoney)}
            </span>
          </li>
          <li className={ui.rowBetween}>
            <span className={styles.totalsLabel}>個人(Darling)</span>
            <span className={styles.totalsValue}>
              {formatMoney(report.common.personalTotalDarling)}
            </span>
          </li>
          <li className={ui.rowBetween}>
            <span className={styles.totalsLabel}>経費(会社)</span>
            <span className={styles.totalsValue}>
              {formatMoney(report.common.businessExpenseTotalSelf)}
            </span>
          </li>
          <li className={ui.rowBetween}>
            <span className={styles.totalsLabel}>NISA積立累計</span>
            <span className={styles.totalsValue}>
              {formatMoney(report.common.nisaContributionAccumulated)}
            </span>
          </li>
        </ul>
      </div>

      <div className={ui.card}>
        <span className={ui.sectionTitle}>未承認振替</span>
        {report.unapprovedTransfers === null || report.unapprovedTransfers.length === 0 ? (
          <div className={ui.empty}>
            {finalized ? '未承認振替はありません' : '確定時に確定します'}
          </div>
        ) : (
          <ul className={styles.totalsList}>
            {report.unapprovedTransfers.map(transfer => (
              <li key={transfer.originalBusinessExpenseTransactionId} className={ui.rowBetween}>
                <span className={styles.totalsLabel}>
                  → {TRANSFER_TARGET_LABELS[transfer.transferTarget]}
                </span>
                <span className={styles.totalsValue}>{formatMoney(transfer.transferAmount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!finalized && (
        <div className={ui.card}>
          <span className={ui.sectionTitle}>レポートの確定</span>
          <p className={styles.finalizeNote}>
            月次レポートは経費精算サイクルの最終確定（精算入金との突合）によって確定されます。
          </p>
          <Link href="/expense-settlement" className={ui.button} style={{ textAlign: 'center' }}>
            経費精算へ進む
          </Link>
        </div>
      )}
    </>
  )
}

export default function ReportsPage() {
  const [month, setMonth] = useState<YearMonth>(getCurrentMonth)

  const reportQuery = useQuery({
    queryKey: ['monthly-reports', month],
    queryFn: () => fetchReport(month),
  })

  return (
    <main className={styles.main}>
      <h1 className={ui.pageTitle}>月次レポート</h1>
      <MonthNavigator month={month} onMonthChange={setMonth} />

      {reportQuery.isLoading && <div className={ui.loading}>読み込み中...</div>}
      {reportQuery.error && <div className={ui.error}>レポートの取得に失敗しました</div>}
      {reportQuery.data === null && (
        <div className={ui.card}>
          <div className={ui.empty}>
            この月のレポートはまだ作成されていません。
            <br />
            CSV 取込の完了後に作成されます。
          </div>
        </div>
      )}
      {reportQuery.data != null && <ReportDetail report={reportQuery.data} />}
    </main>
  )
}
