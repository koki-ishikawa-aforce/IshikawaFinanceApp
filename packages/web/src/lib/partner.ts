import type { UserRole } from '@warimaru/domain'
import type { Theme } from '@/theme/tokens'

/**
 * 画面テーマ（= 閲覧者の役割）から、相手側の役割と呼称を引く。
 *
 * 相手の値（合計のみ公開のもの）を出す箇所は、ロール識別アイコンと呼称を併記する決まりのため
 * （docs/design/usability.md 2-4）、その組を 1 か所で持つ。
 */
const PARTNER: Record<Theme, { role: UserRole; name: string }> = {
  darling: { role: 'honey', name: 'Honey' },
  honey: { role: 'darling', name: 'Darling' },
}

export function partnerOf(theme: Theme): { role: UserRole; name: string } {
  return PARTNER[theme]
}
