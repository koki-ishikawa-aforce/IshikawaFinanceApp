'use client'

import Link from 'next/link'
import type { CategoryBreakdownView } from '@warimaru/domain'
import { DonutChart } from './DonutChart'
import { formatMoney } from '@/lib/format'
import { FALLBACK_CATEGORY_COLORS } from '@/theme/tokens'
import ui from '@/components/ui/common.module.css'
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
  // 支出が 1 件も無い月は、弧の無いドーナツと空の凡例ではなく空状態の案内を出す
  if (data.items.length === 0) {
    return (
      <div className={styles.container}>
        <div className={ui.empty}>
          {data.mode === 'household'
            ? 'この月の世帯支出はありません'
            : 'この月の個人支出はありません'}
        </div>
      </div>
    )
  }

  // 支出の記録はあるが合計が 0 円の月(返金による相殺など)は、割合が定義できず
  // 弧の描けないドーナツと全項目 0.0% の割合表示になる。グラフと割合だけを落とし、
  // 記録されている金額はそのまま見せる
  const hasZeroTotal = data.totalAmount === 0

  const segments = data.items.map((item, i) => ({
    label: item.categoryName,
    percentage: item.percentage,
    color: getColor(item.categoryName, i, categoryColors),
  }))

  return (
    <div className={styles.container}>
      {hasZeroTotal ? (
        <div className={ui.empty}>
          {data.mode === 'household'
            ? 'この月は世帯支出の合計が0円のため、内訳グラフは表示していません'
            : 'この月は個人支出の合計が0円のため、内訳グラフは表示していません'}
        </div>
      ) : (
        <DonutChart segments={segments} totalAmount={data.totalAmount} />
      )}
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
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
