import { z } from 'zod'
import { UserIdSchema, type UserId } from '../../shared/ids'
import { PermissionDeniedError } from '../../shared/errors/DomainError'

/**
 * 所有スコープ（世帯共有 OR 個人別）
 * @see docs/domain/08h-ul-マスタ管理.md §1
 */
export const OwnershipScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('household_shared') }),
  z.object({ kind: z.literal('personal'), userId: UserIdSchema }),
])
export type OwnershipScope = z.infer<typeof OwnershipScopeSchema>

export function assertVisibleTo(scope: OwnershipScope, viewerId: UserId, label: string): void {
  if (scope.kind === 'personal' && scope.userId !== viewerId) {
    throw new PermissionDeniedError(`他ユーザーの${label}は移動先にできない`)
  }
}
