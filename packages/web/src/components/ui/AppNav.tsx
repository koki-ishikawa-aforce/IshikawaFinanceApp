'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LuHouse,
  LuCreditCard,
  LuChartBar,
  LuLandmark,
  LuReceipt,
  LuDownload,
  LuSettings,
} from './icons'
import type { IconType } from './icons'
import styles from './AppNav.module.css'

const NAV_ITEMS: readonly { href: string; icon: IconType; label: string }[] = [
  { href: '/', icon: LuHouse, label: 'ホーム' },
  { href: '/transactions', icon: LuCreditCard, label: '取引' },
  { href: '/reports', icon: LuChartBar, label: 'レポート' },
  { href: '/balances', icon: LuLandmark, label: '残高' },
  { href: '/expense-settlement', icon: LuReceipt, label: '精算' },
  { href: '/imports', icon: LuDownload, label: '取込' },
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
            <Icon className={styles.icon} aria-hidden="true" />
            <span className={styles.label}>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
