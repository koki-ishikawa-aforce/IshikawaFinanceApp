/**
 * 閲覧者コンテキスト（プライバシー判定の入力）
 * @see docs/superpowers/specs/2026-05-01-phase4-tactical-design.md §5.5
 *
 * ViewerRole は shared の UserRole（08f 役割）と同一の値空間。
 * Phase 5 M-A で UserRoleSchema の別名として一本化（エクスポート名は不変）。
 */
import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'
import { UserRoleSchema, type UserRole } from '../../shared/value-objects/UserRole'

export const ViewerRoleSchema = UserRoleSchema
export type ViewerRole = UserRole

export const ViewerContextSchema = z.object({
  viewerId: UserIdSchema,
  role: ViewerRoleSchema,
})
export type ViewerContext = z.infer<typeof ViewerContextSchema>
