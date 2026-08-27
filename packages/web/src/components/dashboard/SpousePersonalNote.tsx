'use client'

import { useState, useCallback, useRef } from 'react'
import type { Theme } from '@/theme/tokens'
import { RoleIcon } from '@/components/ui/RoleIcon'
import { LuX } from '@/components/ui/icons'
import { formatMoney } from '@/lib/format'
import { partnerOf } from '@/lib/partner'
import ui from '@/components/ui/common.module.css'
import styles from './SpousePersonalNote.module.css'

const LONG_PRESS_MS = 500

interface SpousePersonalNoteProps {
  amount: number
  theme: Theme
  /** 相手のニックネーム。未設定・未取得なら null（ロール名で表示） */
  partnerNickname: string | null
}

export function SpousePersonalNote({ amount, theme, partnerNickname }: SpousePersonalNoteProps) {
  const [showHint, setShowHint] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const partner = partnerOf(theme)
  const partnerName = partnerNickname ?? partner.name

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
      aria-label={`${partnerName}の個人費 合計 ${formatMoney(amount)}`}
    >
      <span className={styles.label}>
        <span className={styles.roleMark}>
          <RoleIcon role={partner.role} className={ui.iconSm} />
        </span>
        {partnerName}の個人費（合計のみ）
      </span>
      <span className={styles.amount}>{formatMoney(amount)}</span>
      {showHint && (
        <div
          className={styles.hint}
          role="tooltip"
          onKeyDown={e => e.key === 'Escape' && setShowHint(false)}
        >
          明細はパートナーのみ閲覧可
          <button
            type="button"
            className={styles.hintClose}
            onClick={() => setShowHint(false)}
            aria-label="閉じる"
          >
            <LuX aria-hidden="true" className={ui.iconSm} />
          </button>
        </div>
      )}
    </div>
  )
}
