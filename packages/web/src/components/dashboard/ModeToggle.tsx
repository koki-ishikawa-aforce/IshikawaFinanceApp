'use client'

import type { DashboardMode } from '@warimaru/domain'
import styles from './ModeToggle.module.css'

interface ModeToggleProps {
  mode: DashboardMode
  onModeChange: (mode: DashboardMode) => void
}

export function ModeToggle({ mode, onModeChange }: ModeToggleProps) {
  return (
    <div className={styles.container}>
      <button
        className={`${styles.segment} ${mode === 'household' ? styles.active : ''}`}
        onClick={() => onModeChange('household')}
      >
        世帯
      </button>
      <button
        className={`${styles.segment} ${mode === 'personal' ? styles.active : ''}`}
        onClick={() => onModeChange('personal')}
      >
        個人
      </button>
    </div>
  )
}
