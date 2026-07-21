'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import styles from './AppNav.module.css'

const NAV_ITEMS = [
  { href: '/', icon: '🏠', label: 'ホーム' },
  { href: '/transactions', icon: '💳', label: '取引' },
  { href: '/reports', icon: '📊', label: 'レポート' },
  { href: '/balances', icon: '🏦', label: '残高' },
  { href: '/expense-settlement', icon: '🧾', label: '精算' },
  { href: '/imports', icon: '📥', label: '取込' },
  { href: '/settings', icon: '⚙️', label: '設定' },
] as const

export function AppNav() {
  const pathname = usePathname()

  return (
    <nav className={styles.nav}>
      {NAV_ITEMS.map(item => {
        const active =
          item.href === '/' ? pathname === '/' : (pathname?.startsWith(item.href) ?? false)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? `${styles.item} ${styles.active}` : styles.item}
          >
            <span className={styles.icon}>{item.icon}</span>
            <span className={styles.label}>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
