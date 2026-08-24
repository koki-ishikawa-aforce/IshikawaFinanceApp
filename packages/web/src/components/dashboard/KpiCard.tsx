import Link from 'next/link'
import { LuChevronRight } from '@/components/ui/icons'
import ui from '@/components/ui/common.module.css'
import { formatMoney } from '@/lib/format'
import styles from './KpiCard.module.css'

interface KpiCardProps {
  label: string
  value: number
  isHero?: boolean
  /**
   * 押したときの行き先（spec §5.5 のドリルダウン）。
   * 渡さない指標は押せないままにする（行き先の無いカードを押せるように見せない）。
   */
  href?: string
}

export function KpiCard({ label, value, isHero, href }: KpiCardProps) {
  const body = (
    <>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.value} ${isHero ? styles.heroValue : ''}`}>
        {formatMoney(value)}
      </span>
    </>
  )
  const className = `${styles.card} ${isHero ? styles.hero : ''}`
  if (href === undefined) return <div className={className}>{body}</div>
  // カード全体が押す対象。文字色・下線はリンクの既定に任せず、カードの見た目を保つ。
  // 行き先を持つカードだけに手がかりのアイコンを添え、押せるカードを見分けられるようにする
  return (
    <Link href={href} className={`${className} ${styles.link}`}>
      {body}
      <LuChevronRight aria-hidden="true" className={`${ui.iconSm} ${styles.chevron}`} />
    </Link>
  )
}
