'use client'

import type { CategoryBreakdownView } from '@warimaru/domain'
import { DonutChart } from './DonutChart'
import { formatMoney } from '@/lib/format'
import { FALLBACK_CATEGORY_COLORS } from '@/theme/tokens'
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
  const segments = data.items.map((item, i) => ({
    label: item.categoryName,
    percentage: item.percentage,
    color: getColor(item.categoryName, i, categoryColors),
  }))

  return (
    <div className={styles.container}>
      <DonutChart segments={segments} totalAmount={data.totalAmount} />
      <ul className={styles.legend}>
        {data.items.map((item, i) => (
          <li key={item.categoryId} className={styles.legendItem}>
            <span
              className={styles.dot}
              style={{ backgroundColor: getColor(item.categoryName, i, categoryColors) }}
            />
            <span className={styles.name}>{item.categoryName}</span>
            <span className={styles.amount}>{formatMoney(item.total)}</span>
            <span className={styles.percentage}>{item.percentage.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
