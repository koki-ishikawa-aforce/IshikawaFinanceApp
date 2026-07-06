import { describe, it, expect } from 'vitest'
import {
  GmailOAuthTokenSchema,
  detectTokenRevocation,
  reauthorizeToken,
  type ValidGmailOAuthToken,
} from '../../../src/onboarding-auth/aggregates/GmailOAuthToken'

const valid = {
  kind: 'valid',
  userId: 'line_user_honey' as never,
  tokenStoreRef: '/warimaru/gmail/honey/token' as never,
  authorizedAt: new Date(),
  lastVerifiedAt: new Date(),
}

describe('GmailOAuthToken 集約', () => {
  it('有効トークンは parse 成功', () => {
    expect(() => GmailOAuthTokenSchema.parse(valid)).not.toThrow()
  })

  it('detectTokenRevocation: 有効 → 失効検知済み（両失効理由）', () => {
    const token = GmailOAuthTokenSchema.parse(valid) as ValidGmailOAuthToken
    for (const reason of ['api_call_failure', 'expired'] as const) {
      const revoked = detectTokenRevocation(token, reason, new Date())
      expect(revoked.kind).toBe('revocation_detected')
      expect(revoked.revocationReason).toBe(reason)
    }
  })

  it('reauthorizeToken: 失効検知済み → 有効（再認可）', () => {
    const token = GmailOAuthTokenSchema.parse(valid) as ValidGmailOAuthToken
    const revoked = detectTokenRevocation(token, 'expired', new Date())
    const reauthorized = reauthorizeToken(revoked, new Date())
    expect(reauthorized.kind).toBe('valid')
    expect(reauthorized.tokenStoreRef).toBe(valid.tokenStoreRef)
  })
})
