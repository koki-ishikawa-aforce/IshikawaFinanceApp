'use client'

import Link from 'next/link'
import type { CategoryBreakdownView } from '@warimaru/domain'
import { DonutChart } from './DonutChart'
import { formatMoney } from '@/lib/format'
import { FALLBACK_CATEGORY_COLORS } from '@/theme/tokens'
import { LuChevronRight } from '@/components/ui/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import styles from './CategoryBreakdown.module.css'

interface CategoryBreakdownProps {
  data: CategoryBreakdownView
  categoryColors: Record<string, string>
}

function getColor(name: string, index: number, colors: Record<string, string>): string {
  return (
    colors[name] ?? FALLBACK_CATEGORY_COLORS[index % FALLBACK_CATEGORY_COLORS.length] ?? '#cccccc'
  )
}

export function CategoryBreakdown({ data, categoryColors }: CategoryBreakdownProps) {
  const spendingLabel = data.mode === 'household' ? '世帯支出' : '個人支出'

  // 支出が 1 件も無い月
  const isEmpty = data.items.length === 0

  // 支出の記録はあるが合計が 0 円の月(返金による相殺など)。割合が定義できないため、
  // 弧の描けないドーナツと全項目 0.0% の割合表示になる。グラフと割合だけを落とし、
  // 記録されている金額はそのまま見せる(#340)
  const hasZeroTotal = !isEmpty && data.totalAmount === 0

  const segments = data.items.map((item, i) => ({
    label: item.categoryName,
    percentage: item.percentage,
    color: getColor(item.categoryName, i, categoryColors),
  }))

  return (
    <div className={styles.container}>
      {/*
        月・モードの切り替えでこの領域はドーナツ ⇄ 案内文に入れ替わる。ページ遷移を
        伴わないため、role="status" が無いと支援技術に変化が伝わらない
        (docs/design/usability.md 8-4)。live region はこの器に常設し、入れ替わる側の
        EmptyState は announce={false} にして live region の入れ子を避ける
      */}
      <div role="status">
        {isEmpty ? (
          <EmptyState announce={false}>{`この月の${spendingLabel}はありません`}</EmptyState>
        ) : hasZeroTotal ? (
          <EmptyState announce={false}>
            {`この月は返金などで${spendingLabel}の合計が0円になったため、内訳グラフは表示していません`}
          </EmptyState>
        ) : (
          <DonutChart segments={segments} totalAmount={data.totalAmount} />
        )}
      </div>
      {!isEmpty && (
        <ul className={styles.legend}>
          {data.items.map((item, i) => (
            <li key={item.categoryId}>
              {/* ドリルダウン ⑧: 凡例タップで取引一覧へ（フィルタ: 表示中の月 + そのカテゴリ） */}
              <Link
                href={`/transactions?month=${data.yearMonth}&categoryId=${item.categoryId}`}
                className={styles.legendItem}
              >
                <span
                  className={styles.dot}
                  style={{ backgroundColor: getColor(item.categoryName, i, categoryColors) }}
                />
                <span className={styles.name}>{item.categoryName}</span>
                <span className={styles.amount}>{formatMoney(item.total)}</span>
                {!hasZeroTotal && (
                  <span className={styles.percentage}>{item.percentage.toFixed(1)}%</span>
                )}
                <LuChevronRight className={styles.chevron} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
