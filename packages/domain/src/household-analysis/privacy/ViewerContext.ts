/**
 * 閲覧者コンテキスト（プライバシー判定の入力）
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.5
 */
import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'

export const ViewerRoleSchema = z.enum(['honey', 'darling'])
export type ViewerRole = z.infer<typeof ViewerRoleSchema>

export const ViewerContextSchema = z.object({
  viewerId: UserIdSchema,
  role: ViewerRoleSchema,
})
export type ViewerContext = z.infer<typeof ViewerContextSchema>
