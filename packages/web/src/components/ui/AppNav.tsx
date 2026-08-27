'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LuHouse, LuCreditCard, LuChartBar, LuLandmark, LuSettings } from './icons'
import type { IconType } from './icons'
import styles from './AppNav.module.css'
import ui from './common.module.css'

/**
 * よく使う5項目のみを常設する(Issue #614)。精算・取込は使う頻度が低く、
 * 隣接タップ間隔の下限(usability §4-4)を満たす幅が320px幅の端末に収まらないため
 * 選択肢A(項目を減らす)で除外し、設定画面の入り口リンクへ移した。
 */
const NAV_ITEMS: readonly { href: string; icon: IconType; label: string }[] = [
  { href: '/', icon: LuHouse, label: 'ホーム' },
  { href: '/transactions', icon: LuCreditCard, label: '取引' },
  { href: '/reports', icon: LuChartBar, label: 'レポート' },
  { href: '/balances', icon: LuLandmark, label: '残高' },
  { href: '/settings', icon: LuSettings, label: '設定' },
]

export function AppNav() {
  const pathname = usePathname()

  return (
    <nav className={styles.nav}>
      {NAV_ITEMS.map(item => {
        const active =
          item.href === '/' ? pathname === '/' : (pathname?.startsWith(item.href) ?? false)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? `${styles.item} ${styles.active}` : styles.item}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className={`${ui.iconLg} ${styles.icon}`} aria-hidden="true" />
            <span className={styles.label}>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
