'use client'

import type { YearMonth } from '@warimaru/domain'
import { LuChevronLeft, LuChevronRight } from '@/components/ui/icons'
import ui from '@/components/ui/common.module.css'
import styles from './MonthNavigator.module.css'

interface MonthNavigatorProps {
  month: YearMonth
  onMonthChange: (month: YearMonth) => void
}

function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const [yStr, mStr] = ym.split('-')
  let y = Number(yStr)
  let m = Number(mStr) + delta
  if (m < 1) {
    y -= 1
    m = 12
  } else if (m > 12) {
    y += 1
    m = 1
  }
  return `${y}-${String(m).padStart(2, '0')}` as YearMonth
}

function formatMonthLabel(ym: YearMonth): string {
  const [yStr, mStr] = ym.split('-')
  return `${yStr}年${Number(mStr)}月`
}

export function MonthNavigator({ month, onMonthChange }: MonthNavigatorProps) {
  return (
    <div className={styles.container}>
      <button
        className={styles.button}
        onClick={() => onMonthChange(shiftMonth(month, -1))}
        aria-label="前月"
      >
        <LuChevronLeft aria-hidden="true" className={ui.iconLg} />
      </button>
      <span className={styles.label}>{formatMonthLabel(month)}</span>
      <button
        className={styles.button}
        onClick={() => onMonthChange(shiftMonth(month, 1))}
        aria-label="次月"
      >
        <LuChevronRight aria-hidden="true" className={ui.iconLg} />
      </button>
    </div>
  )
}
