/**
 * GmailOAuthGateway のモック / 未構成フォールバック実装
 *
 * - モック: DATABASE_URL 未設定の開発・テストモード用。実 Google API を呼ばず、
 *   state の署名・検証のみ本物と同じ codec で行う（コールバックフローを検証可能）
 * - 未構成: 実 DB モードで GOOGLE_OAUTH_* が未設定のとき、呼び出し時に明示的に失敗させる
 */
import type { GmailOAuthGateway } from '@warimaru/domain'
import {
  InvariantViolationError,
  ParameterStorePathSchema,
  PermissionDeniedError,
} from '@warimaru/domain'
import type { GmailOAuthStateCodec } from './state.js'

export function createMockGmailOAuthGateway(stateCodec: GmailOAuthStateCodec): GmailOAuthGateway {
  return {
    buildAuthorizationUrl(userId) {
      const state = encodeURIComponent(stateCodec.sign(userId))
      return Promise.resolve(`https://accounts.google.com/o/oauth2/v2/auth?mock=1&state=${state}`)
    },
    completeAuthorization(state, _authorizationCode) {
      const userId = stateCodec.verify(state)
      if (userId === null) {
        return Promise.reject(
          new PermissionDeniedError('OAuth state の検証に失敗した（改竄または期限切れ）'),
        )
      }
      return Promise.resolve({
        userId,
        tokenStoreRef: ParameterStorePathSchema.parse(`/warimaru/gmail-oauth/${userId}`),
      })
    },
  }
}

export function createUnconfiguredGmailOAuthGateway(): GmailOAuthGateway {
  const fail = (): never => {
    throw new InvariantViolationError(
      'Gmail OAuth が未構成（GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REDIRECT_URI を設定する）',
    )
  }
  return {
    buildAuthorizationUrl: () => Promise.resolve(fail()),
    completeAuthorization: () => Promise.resolve(fail()),
  }
}
