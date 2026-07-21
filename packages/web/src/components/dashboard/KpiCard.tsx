import { formatMoney } from '@/lib/format'
import { useTheme } from '@/theme/ThemeProvider'
import { getHeroDecorationEmoji } from '@/theme/tokens'
import styles from './KpiCard.module.css'

interface KpiCardProps {
  label: string
  value: number
  isHero?: boolean
}

export function KpiCard({ label, value, isHero }: KpiCardProps) {
  const theme = useTheme()
  const heroEmoji = getHeroDecorationEmoji(theme)

  return (
    <div className={`${styles.card} ${isHero ? styles.hero : ''}`}>
      {isHero && <span className={styles.decoration}>{heroEmoji}</span>}
      <span className={styles.label}>{label}</span>
      <span className={`${styles.value} ${isHero ? styles.heroValue : ''}`}>
        {formatMoney(value)}
      </span>
    </div>
  )
}
