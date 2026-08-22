import type { UserRole } from '@warimaru/domain'
import { LuFlower2, LuSailboat } from './icons'
import type { IconType } from './icons'

const ROLE_ICONS: Record<UserRole, { Icon: IconType; colorVar: string }> = {
  darling: { Icon: LuFlower2, colorVar: 'var(--role-darling)' },
  honey: { Icon: LuSailboat, colorVar: 'var(--role-honey)' },
}

interface RoleIconProps {
  role: UserRole
  /**
   * 大きさは DESIGN.md §4 のスケール（`common.module.css` の `.iconSm` 等）を渡す。
   *
   * 省略できるようにすると react-icons 既定の 1em で描画されスケールの外に出るため、
   * 省略不可にしている（CSS モジュールのクラス名は `string | undefined` 型のため、
   * 型自体は undefined を受けるが、プロパティを書き忘れればコンパイルエラーになる）。
   */
  className: string | undefined
}

export function RoleIcon({ role, className }: RoleIconProps) {
  const { Icon, colorVar } = ROLE_ICONS[role]
  return <Icon color={colorVar} aria-hidden="true" className={className} />
}
