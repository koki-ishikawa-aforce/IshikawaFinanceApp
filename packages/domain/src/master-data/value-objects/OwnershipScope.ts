import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'

/**
 * 所有スコープ（世帯共有 OR 個人別）
 * @see docs/domain/08h-ul-マスタ管理.md §1
 */
export const OwnershipScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('household_shared') }),
  z.object({ kind: z.literal('personal'), userId: UserIdSchema }),
])
export type OwnershipScope = z.infer<typeof OwnershipScopeSchema>
