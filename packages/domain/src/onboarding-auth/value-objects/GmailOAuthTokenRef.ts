/**
 * Gmail OAuth トークン参照（実体は Parameter Store、ドメインはパスのみ保持）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 */
import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'
import { ParameterStorePathSchema } from '../../shared/value-objects/ParameterStorePath'

export const GmailOAuthTokenRefSchema = z.object({
  userId: UserIdSchema,
  tokenStoreRef: ParameterStorePathSchema,
})
export type GmailOAuthTokenRef = z.infer<typeof GmailOAuthTokenRefSchema>
