/**
 * Gmail OAuth トークン Repository I/F
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 */
import type { UserId } from '../../shared/ids'
import type { GmailOAuthToken } from '../aggregates/GmailOAuthToken'

export interface GmailOAuthTokenRepository {
  findByUserId(userId: UserId): Promise<GmailOAuthToken | null>
  save(token: GmailOAuthToken): Promise<void>
}
