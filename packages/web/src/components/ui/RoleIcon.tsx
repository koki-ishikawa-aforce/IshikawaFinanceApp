import { LuFlower2, LuSailboat } from './icons'
import type { IconType } from 'react-icons'

type Role = 'darling' | 'honey'

const ROLE_ICONS: Record<Role, { Icon: IconType; colorVar: string }> = {
  darling: { Icon: LuFlower2, colorVar: 'var(--role-darling)' },
  honey: { Icon: LuSailboat, colorVar: 'var(--role-honey)' },
}

interface RoleIconProps {
  role: Role
  size?: string | number
  className?: string
}

export function RoleIcon({ role, size, className }: RoleIconProps) {
  const { Icon, colorVar } = ROLE_ICONS[role]
  return <Icon size={size} color={colorVar} aria-hidden="true" className={className} />
}
