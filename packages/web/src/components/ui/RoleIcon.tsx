import type { UserRole } from '@warimaru/domain'
import { LuFlower2, LuSailboat } from './icons'
import type { IconType } from './icons'

const ROLE_ICONS: Record<UserRole, { Icon: IconType; colorVar: string }> = {
  darling: { Icon: LuFlower2, colorVar: 'var(--role-darling)' },
  honey: { Icon: LuSailboat, colorVar: 'var(--role-honey)' },
}

interface RoleIconProps {
  role: UserRole
  size?: string | number
  className?: string
}

export function RoleIcon({ role, size, className }: RoleIconProps) {
  const { Icon, colorVar } = ROLE_ICONS[role]
  return <Icon size={size} color={colorVar} aria-hidden="true" className={className} />
}
