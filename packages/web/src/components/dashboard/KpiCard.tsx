import { formatMoney } from '@/lib/format'
import styles from './KpiCard.module.css'

interface KpiCardProps {
  label: string
  value: number
  isHero?: boolean
}

export function KpiCard({ label, value, isHero }: KpiCardProps) {
  return (
    <div className={`${styles.card} ${isHero ? styles.hero : ''}`}>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.value} ${isHero ? styles.heroValue : ''}`}>
        {formatMoney(value)}
      </span>
    </div>
  )
}
