'use client'

import Link from 'next/link'
import type { CategoryBreakdownView } from '@warimaru/domain'
import { DonutChart } from './DonutChart'
import { formatMoney } from '@/lib/format'
import { FALLBACK_CATEGORY_COLORS } from '@/theme/tokens'
import { LuChevronRight } from '@/components/ui/icons'
import { EmptyState } from '@/components/ui/EmptyState'
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
  const spendingLabel = data.mode === 'household' ? '世帯支出' : '個人支出'

  // 支出が 1 件も無い月
  const isEmpty = data.items.length === 0

  // 支出の記録はあるが割合を算出できない月(返金が支出と相殺する / 支出を上回る)。
  // 集計側(PostgresDashboardQuery)が合計 0 円以下の月は percentage を null で返すため、
  // ここでは totalAmount を自分で判定し直さず、その null をそのまま受け取る。
  // どちらもグラフと割合だけを落とし、記録されている金額はそのまま見せる
  // (#340 で 0 円、#409 で負の月を同じ扱いに揃えた)
  const isPercentageMeaningless = !isEmpty && data.items.every(item => item.percentage === null)

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
        ) : isPercentageMeaningless ? (
          <EmptyState announce={false}>
            {`この月は返金などで${spendingLabel}の割合を計算できないため、内訳グラフは表示せずカテゴリごとの金額のみ表示しています`}
          </EmptyState>
        ) : (
          <DonutChart
            segments={data.items.map((item, i) => ({
              label: item.categoryName,
              // percentage は項目単位で null になりうる(スキーマ上の型)。実際の集計
              // (PostgresDashboardQuery)は月全体で一括して null/非null を返すため
              // 混在は起きないが、型がそれを保証しないため 0% として安全側にフォールバックする
              percentage: item.percentage ?? 0,
              color: getColor(item.categoryName, i, categoryColors),
            }))}
            totalAmount={data.totalAmount}
          />
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
                {/*
                  色ドットはグラフの弧との対応づけだけでなく、カテゴリそのものの目印として
                  月をまたいで同じ色で出す。グラフを出さない月(割合が計算できない月)でも
                  残すのはこのため
                */}
                <span
                  className={styles.dot}
                  style={{ backgroundColor: getColor(item.categoryName, i, categoryColors) }}
                />
                <span className={styles.name}>{item.categoryName}</span>
                <span className={styles.amount}>{formatMoney(item.total)}</span>
                {item.percentage !== null && (
                  <span className={styles.percentage}>{item.percentage.toFixed(1)}%</span>
                )}
                <LuChevronRight className={`${ui.iconSm} ${styles.chevron}`} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
