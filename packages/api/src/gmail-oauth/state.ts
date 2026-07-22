/**
 * Gmail OAuth の state パラメータ署名（CSRF 対策 + userId の封入）
 *
 * OQ-7: 認可は liff.openWindow({external: true}) で OS 標準ブラウザに切り出すため、
 * コールバックは LIFF セッション（LINE ID トークン）の外で到達する。state に
 * userId を HMAC 署名付きで封入し、コールバック側で復元・検証する。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { UserId } from '@warimaru/domain'
import { UserIdSchema } from '@warimaru/domain'

export interface GmailOAuthStateCodec {
  sign(userId: UserId): string
  /** 署名検証に失敗（改竄・別 secret）なら null */
  verify(state: string): UserId | null
}

export function createGmailOAuthStateCodec(secret: string): GmailOAuthStateCodec {
  const mac = (payload: string): string =>
    createHmac('sha256', secret).update(payload).digest('base64url')
  return {
    sign(userId) {
      const payload = Buffer.from(userId, 'utf8').toString('base64url')
      return `${payload}.${mac(payload)}`
    },
    verify(state) {
      const [payload, signature] = state.split('.')
      if (payload === undefined || signature === undefined) return null
      const expected = Buffer.from(mac(payload))
      const actual = Buffer.from(signature)
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
      const parsed = UserIdSchema.safeParse(Buffer.from(payload, 'base64url').toString('utf8'))
      return parsed.success ? parsed.data : null
    },
  }
}
