import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'

/**
 * 許可リスト（夫婦 2 名の LINE userID）
 * @see docs/domain/08h-ul-マスタ管理.md §1
 *
 * 役割名は Honey / Darling（Phase 3.5）だが、Parameter Store キーは互換のため
 * HUSBAND_LINE_USER_ID / WIFE_LINE_USER_ID を維持する。
 */
export const AllowlistSchema = z.object({
  honeyLineUserId: UserIdSchema,
  darlingLineUserId: UserIdSchema,
})
export type Allowlist = z.infer<typeof AllowlistSchema>
