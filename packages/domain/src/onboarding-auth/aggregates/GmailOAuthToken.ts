/**
 * Gmail OAuth トークン集約（オンボーディング・認証コンテキスト）
 * @see docs/domain/08f-ul-オンボーディング認証.md §1
 * @see docs/superpowers/plans/2026-07-06-phase5-m-a-context-typing.md §2.4
 *
 * kawasima: data Gmail_OAuth_トークン = 有効トークン OR 失効検知済みトークン
 *
 * トークン実体は Parameter Store に保管し、ドメインはパスのみ保持する。
 * ユーザーごとに 1 件（UserId キー、専用 ID なし）。
 * 失効時の通知は個別 DM のみ（OQ-2 ✅: メールフェイルセーフ対象外）。
 */
import { z } from 'zod'
import { UserIdSchema } from '../../shared/ids'
import { ParameterStorePathSchema } from '../../shared/value-objects/ParameterStorePath'

export const TokenRevocationReasonSchema = z.enum(['api_call_failure', 'expired'])
export type TokenRevocationReason = z.infer<typeof TokenRevocationReasonSchema>

export const GmailOAuthTokenSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('valid'),
    userId: UserIdSchema,
    tokenStoreRef: ParameterStorePathSchema,
    authorizedAt: z.date(),
    lastVerifiedAt: z.date(),
  }),
  z.object({
    kind: z.literal('revocation_detected'),
    userId: UserIdSchema,
    tokenStoreRef: ParameterStorePathSchema,
    authorizedAt: z.date(),
    revocationDetectedAt: z.date(),
    revocationReason: TokenRevocationReasonSchema,
  }),
])
export type GmailOAuthToken = z.infer<typeof GmailOAuthTokenSchema>

export type ValidGmailOAuthToken = Extract<GmailOAuthToken, { kind: 'valid' }>
export type RevokedGmailOAuthToken = Extract<GmailOAuthToken, { kind: 'revocation_detected' }>

/** 状態遷移: 有効 → 失効検知済み */
export function detectTokenRevocation(
  token: ValidGmailOAuthToken,
  reason: TokenRevocationReason,
  at: Date,
): RevokedGmailOAuthToken {
  return GmailOAuthTokenSchema.parse({
    kind: 'revocation_detected',
    userId: token.userId,
    tokenStoreRef: token.tokenStoreRef,
    authorizedAt: token.authorizedAt,
    revocationDetectedAt: at,
    revocationReason: reason,
  }) as RevokedGmailOAuthToken
}

/** 状態遷移: 失効検知済み → 有効（再認可完了。メール取込が再開される） */
export function reauthorizeToken(token: RevokedGmailOAuthToken, at: Date): ValidGmailOAuthToken {
  return GmailOAuthTokenSchema.parse({
    kind: 'valid',
    userId: token.userId,
    tokenStoreRef: token.tokenStoreRef,
    authorizedAt: at,
    lastVerifiedAt: at,
  }) as ValidGmailOAuthToken
}
