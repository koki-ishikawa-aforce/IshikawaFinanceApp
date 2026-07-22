/**
 * GmailOAuthGateway の Google OAuth 2.0 実装（ACL 翻訳層）
 * @see docs/domain/08f-ul-オンボーディング認証.md §2「Gmail OAuth認可を開始する / 完了する」
 *
 * 認可コードをトークンに交換し、トークン実体（JSON そのまま）を Parameter Store
 * （KMS SecureString）へ保管する。ドメインへは保管先パスのみ返す。
 */
import type { GmailOAuthGateway, ParameterStorePath, UserId } from '@warimaru/domain'
import { ParameterStorePathSchema, PermissionDeniedError } from '@warimaru/domain'
import type { GmailOAuthStateCodec } from './state.js'

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

export interface GoogleGmailOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** トークン保管先パスの接頭辞（既定: /warimaru/gmail-oauth） */
  tokenStorePathPrefix?: string | undefined
}

export interface GoogleGmailOAuthGatewayDeps {
  stateCodec: GmailOAuthStateCodec
  /** Parameter Store（KMS）へのシークレット書込み */
  storeSecret: (path: string, value: string) => Promise<void>
}

export class GoogleGmailOAuthGateway implements GmailOAuthGateway {
  constructor(
    private readonly config: GoogleGmailOAuthConfig,
    private readonly deps: GoogleGmailOAuthGatewayDeps,
  ) {}

  buildAuthorizationUrl(userId: UserId): Promise<string> {
    const url = new URL(GOOGLE_AUTH_ENDPOINT)
    url.searchParams.set('client_id', this.config.clientId)
    url.searchParams.set('redirect_uri', this.config.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', GMAIL_READONLY_SCOPE)
    // refresh token を確実に得る（メール取込の長期実行に必須）
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('state', this.deps.stateCodec.sign(userId))
    return Promise.resolve(url.toString())
  }

  async completeAuthorization(
    state: string,
    authorizationCode: string,
  ): Promise<{ userId: UserId; tokenStoreRef: ParameterStorePath }> {
    const userId = this.deps.stateCodec.verify(state)
    if (userId === null) {
      throw new PermissionDeniedError('OAuth state の検証に失敗した（改竄または期限切れ）')
    }
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: authorizationCode,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    if (!response.ok) {
      const detail = await response.text()
      throw new Error(`Google OAuth トークン交換に失敗した (${response.status}): ${detail}`)
    }
    const tokenJson = await response.text()
    const prefix = this.config.tokenStorePathPrefix ?? '/warimaru/gmail-oauth'
    const path = `${prefix}/${userId}`
    await this.deps.storeSecret(path, tokenJson)
    return { userId, tokenStoreRef: ParameterStorePathSchema.parse(path) }
  }
}
