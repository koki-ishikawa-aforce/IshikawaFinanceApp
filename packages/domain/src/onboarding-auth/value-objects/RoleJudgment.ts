/**
 * 役割判定結果（許可リスト照合）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 *
 * kawasima: data 役割判定結果 = 役割確定 OR 役割拒否
 */
import { z } from 'zod'
import { UserIdSchema, type UserId } from '../../shared/ids'
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

/**
 * 役割を判定する（許可リスト照合、08f §2）
 * behavior 役割を判定する = LINE_userID AND 許可リスト -> 役割判定結果
 *
 * 許可リストはマスタ管理からのクロスコンテキスト借用（08f §1: ID のみ借用）のため、
 * 構造的型で受ける（master-data の `Allowlist` がそのまま渡せる）。
 * 一致しなければ 役割拒否（許可リスト不一致、P1-2）。
 */
export function judgeRole(
  lineUserId: UserId,
  allowlist: { honeyLineUserId: UserId; darlingLineUserId: UserId },
  at: Date,
): RoleJudgment {
  const role =
    allowlist.honeyLineUserId === lineUserId
      ? ('honey' as const)
      : allowlist.darlingLineUserId === lineUserId
        ? ('darling' as const)
        : null
  if (role === null) {
    return RoleJudgmentSchema.parse({
      kind: 'rejected',
      lineUserId,
      rejectedAt: at,
      reason: 'allowlist_mismatch',
    })
  }
  return RoleJudgmentSchema.parse({ kind: 'accepted', lineUserId, role, judgedAt: at })
}
