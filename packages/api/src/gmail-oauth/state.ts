/**
 * Gmail OAuth の state パラメータ署名（CSRF 対策 + userId の封入）
 *
 * OQ-7: 認可は liff.openWindow({external: true}) で OS 標準ブラウザに切り出すため、
 * コールバックは LIFF セッション（LINE ID トークン）の外で到達する。state に
 * userId と発行時刻を HMAC 署名付きで封入し、コールバック側で復元・検証する
 * （TTL 超過の state は失効扱い）。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { UserId } from '@warimaru/domain'
import { UserIdSchema } from '@warimaru/domain'

/** 認可開始からコールバックまでの猶予（Google の同意画面操作を見込む） */
const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000

export interface GmailOAuthStateCodec {
  sign(userId: UserId): string
  /** 署名検証に失敗（改竄・別 secret）または TTL 超過なら null */
  verify(state: string): UserId | null
}

export function createGmailOAuthStateCodec(
  secret: string,
  ttlMs: number = DEFAULT_STATE_TTL_MS,
): GmailOAuthStateCodec {
  const mac = (payload: string): string =>
    createHmac('sha256', secret).update(payload).digest('base64url')
  return {
    sign(userId) {
      const payload = Buffer.from(
        JSON.stringify({ userId, issuedAt: Date.now() }),
        'utf8',
      ).toString('base64url')
      return `${payload}.${mac(payload)}`
    },
    verify(state) {
      const [payload, signature] = state.split('.')
      if (payload === undefined || signature === undefined) return null
      const expected = Buffer.from(mac(payload))
      const actual = Buffer.from(signature)
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
      try {
        const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
          userId?: unknown
          issuedAt?: unknown
        }
        if (typeof decoded.issuedAt !== 'number' || Date.now() - decoded.issuedAt > ttlMs) {
          return null
        }
        const parsed = UserIdSchema.safeParse(decoded.userId)
        return parsed.success ? parsed.data : null
      } catch {
        return null
      }
    },
  }
}
