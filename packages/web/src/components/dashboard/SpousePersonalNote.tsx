'use client'

import { useState, useCallback, useRef } from 'react'
import type { Theme } from '@/theme/tokens'
import { RoleIcon } from '@/components/ui/RoleIcon'
import { formatMoney } from '@/lib/format'
import styles from './SpousePersonalNote.module.css'

const PARTNER_LABEL: Record<Theme, { role: 'honey' | 'darling'; name: string }> = {
  darling: { role: 'honey', name: 'Honey' },
  honey: { role: 'darling', name: 'Darling' },
}

const LONG_PRESS_MS = 500

interface SpousePersonalNoteProps {
  amount: number
  theme: Theme
}

export function SpousePersonalNote({ amount, theme }: SpousePersonalNoteProps) {
  const [showHint, setShowHint] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const partner = PARTNER_LABEL[theme]

  const handleTouchStart = useCallback(() => {
    timerRef.current = setTimeout(() => setShowHint(true), LONG_PRESS_MS)
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setShowHint(true)
  }, [])

  return (
    <div
      className={styles.container}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onContextMenu={handleContextMenu}
      role="note"
      aria-label={`${partner.name}の個人費 合計 ${formatMoney(amount)}`}
    >
      <span className={styles.label}>
        <span className={styles.emoji}>
          <RoleIcon role={partner.role} size="1em" />
        </span>
        {partner.name}の個人費（合計のみ）
      </span>
      <span className={styles.amount}>{formatMoney(amount)}</span>
      {showHint && (
        <div
          className={styles.hint}
          role="tooltip"
          onClick={() => setShowHint(false)}
          onKeyDown={e => e.key === 'Escape' && setShowHint(false)}
        >
          明細はパートナーのみ閲覧可
        </div>
      )}
    </div>
  )
}
