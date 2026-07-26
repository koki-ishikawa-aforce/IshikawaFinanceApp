'use client'

import type { BalancePointWire } from '@/lib/api-schemas'
import { EmptyState } from '@/components/ui/EmptyState'
import styles from './TimeSeriesChart.module.css'

export interface ChartSeries {
  label: string
  cssColorVar: string
  points: BalancePointWire[]
}

interface TimeSeriesChartProps {
  series: ChartSeries[]
}

const WIDTH = 272
const HEIGHT = 140
const PAD_X = 6
const PAD_Y = 10

/** 資産推移の 4 軸折れ線チャート（SVG、テーマ CSS 変数で着色） */
export function TimeSeriesChart({ series }: TimeSeriesChartProps) {
  const allPoints = series.flatMap(s => s.points)
  if (allPoints.length === 0) {
    return <EmptyState>表示できるデータがありません</EmptyState>
  }

  const times = allPoints.map(p => p.date.getTime())
  const amounts = allPoints.map(p => p.amount)
  const minT = Math.min(...times)
  const maxT = Math.max(...times)
  const minA = Math.min(0, ...amounts)
  const maxA = Math.max(...amounts)
  const tRange = maxT - minT || 1
  const aRange = maxA - minA || 1

  const x = (t: number) => PAD_X + ((t - minT) / tRange) * (WIDTH - PAD_X * 2)
  const y = (a: number) => HEIGHT - PAD_Y - ((a - minA) / aRange) * (HEIGHT - PAD_Y * 2)

  return (
    <div className={styles.container}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className={styles.svg}
        role="img"
        aria-label="資産推移チャート"
      >
        {minA < 0 && (
          <line x1={PAD_X} y1={y(0)} x2={WIDTH - PAD_X} y2={y(0)} className={styles.zeroLine} />
        )}
        {series.map(s => {
          if (s.points.length === 0) return null
          const sorted = [...s.points].sort((a, b) => a.date.getTime() - b.date.getTime())
          const path = sorted
            .map(
              (p, i) =>
                `${i === 0 ? 'M' : 'L'} ${x(p.date.getTime()).toFixed(1)} ${y(p.amount).toFixed(1)}`,
            )
            .join(' ')
          return (
            <g key={s.label} style={{ color: `var(${s.cssColorVar})` }}>
              <path d={path} className={styles.line} />
              {sorted.map(p => (
                <circle
                  key={p.date.getTime()}
                  cx={x(p.date.getTime())}
                  cy={y(p.amount)}
                  r={2.2}
                  className={styles.dot}
                />
              ))}
            </g>
          )
        })}
      </svg>
      <div className={styles.legend}>
        {series.map(s => (
          <span key={s.label} className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ background: `var(${s.cssColorVar})` }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
