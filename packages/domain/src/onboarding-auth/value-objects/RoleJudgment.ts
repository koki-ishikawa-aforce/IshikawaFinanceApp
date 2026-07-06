/**
 * 役割判定結果（許可リスト照合）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 *
 * kawasima: data 役割判定結果 = 役割確定 OR 役割拒否
 */
import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'
import { UserRoleSchema } from '../../shared/value-objects/UserRole'

export const RoleJudgmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('accepted'),
    lineUserId: UserIdSchema,
    role: UserRoleSchema,
    judgedAt: z.date(),
  }),
  z.object({
    kind: z.literal('rejected'),
    lineUserId: UserIdSchema,
    rejectedAt: z.date(),
    reason: z.literal('allowlist_mismatch'),
  }),
])
export type RoleJudgment = z.infer<typeof RoleJudgmentSchema>
