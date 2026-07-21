'use client'

import { formatMoney } from '@/lib/format'
import styles from './DonutChart.module.css'

interface DonutSegment {
  label: string
  percentage: number
  color: string
}

interface DonutChartProps {
  segments: DonutSegment[]
  totalAmount: number
}

const SIZE = 160
const STROKE_WIDTH = 28
const RADIUS = (SIZE - STROKE_WIDTH) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const GAP_DEGREES = 3

export function DonutChart({ segments, totalAmount }: DonutChartProps) {
  let currentOffset = -90

  const arcs = segments.map(seg => {
    const gapFraction = GAP_DEGREES / 360
    const segDegrees = (seg.percentage / 100) * 360
    const drawDegrees = Math.max(0, segDegrees - GAP_DEGREES)
    const drawFraction = drawDegrees / 360
    const dashLength = drawFraction * CIRCUMFERENCE
    const rotation = currentOffset + (gapFraction * 360) / 2

    currentOffset += segDegrees

    return {
      ...seg,
      dashLength,
      gapLength: CIRCUMFERENCE - dashLength,
      rotation,
    }
  })

  return (
    <div className={styles.container}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} className={styles.svg}>
        {arcs.map((arc, i) => (
          <circle
            key={i}
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={arc.color}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeDasharray={`${arc.dashLength} ${arc.gapLength}`}
            transform={`rotate(${arc.rotation} ${SIZE / 2} ${SIZE / 2})`}
          />
        ))}
      </svg>
      <div className={styles.center}>
        <span className={styles.totalLabel}>合計</span>
        <span className={styles.totalValue}>{formatMoney(totalAmount)}</span>
      </div>
    </div>
  )
}
