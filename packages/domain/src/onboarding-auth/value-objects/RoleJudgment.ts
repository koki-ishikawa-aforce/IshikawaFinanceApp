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
import { InvariantViolationError } from '../../shared/errors/DomainError'

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

/**
 * 閲覧者から配偶者のユーザーIDを導出する（許可リスト照合、08f §1）
 *
 * 2 人世帯の許可リストで閲覧者に一致しない側を配偶者とする。配偶者行が
 * 未登録のとき（相手が未オンボーディング）に spouseUserId を補うために使う。
 * 閲覧者が許可リストに含まれなければ不変条件違反（`judgeRole` の拒否と同じ根拠）。
 *
 * 許可リストはマスタ管理からのクロスコンテキスト借用（08f §1: ID のみ借用）のため、
 * `judgeRole` と同じく構造的型で受ける。Query 実装（PostgreSQL / モック）が共有する。
 */
export function resolveSpouseUserId(
  viewerId: UserId,
  allowlist: { honeyLineUserId: UserId; darlingLineUserId: UserId },
): UserId {
  if (allowlist.honeyLineUserId === viewerId) return allowlist.darlingLineUserId
  if (allowlist.darlingLineUserId === viewerId) return allowlist.honeyLineUserId
  throw new InvariantViolationError(`viewer ${viewerId} は許可リストに含まれていない`)
}
