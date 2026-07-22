/**
 * Gmail OAuth コールバック（#41）
 *
 * OQ-7: 認可は OS 標準ブラウザで行われるため、このルートは LIFF 認証（/api/*
 * ミドルウェア）の外（/oauth/gmail/callback）にマウントする。ユーザーの特定は
 * state パラメータ（HMAC 署名付き userId、GmailOAuthGateway が検証）で行う。
 *
 * コールバック成功時:
 * 1. トークン実体を Parameter Store に保管（gateway 内部）
 * 2. GmailOAuthToken 集約を保存（新規 = valid / 失効検知済み = 再認可で valid へ）
 * 3. Phase2 進行中なら AppUser の SectionA を完了（GmailOAuthTokenRef の記録）
 * 応答は OS ブラウザ向けの簡易 HTML（LINE へ戻る案内）。
 */
import { Hono } from 'hono'
import {
  GmailLinkCompletedSchema,
  GmailOAuthTokenSchema,
  GmailReauthorizationCompletedSchema,
  PermissionDeniedError,
  SectionACompletedSchema,
  completeSectionA,
  reauthorizeToken,
} from '@warimaru/domain'
import type {
  AppUserRepository,
  EventBus,
  GmailOAuthGateway,
  GmailOAuthTokenRepository,
} from '@warimaru/domain'
import { domainEventBase } from '../event-handlers/index.js'

export interface GmailOAuthRoutesDeps {
  appUserRepository: AppUserRepository
  gmailOAuthTokenRepository: GmailOAuthTokenRepository
  gmailOAuthGateway: GmailOAuthGateway
  eventBus: EventBus
}

function page(title: string, message: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - 割まる</title></head><body style="font-family:sans-serif;text-align:center;padding:3rem 1rem"><h1 style="font-size:1.2rem">${title}</h1><p>${message}</p></body></html>`
}

export function gmailOAuthRoutes(deps: GmailOAuthRoutesDeps): Hono {
  const app = new Hono()

  app.get('/callback', async c => {
    const { code, state, error } = c.req.query()
    if (error !== undefined) {
      // ユーザーによるキャンセル等（OAuthキャンセル、08f §2）
      return c.html(
        page('Gmail 連携がキャンセルされました', 'LINE アプリに戻ってやり直してください。'),
      )
    }
    if (code === undefined || state === undefined) {
      return c.html(page('リクエストが不正です', 'LINE アプリに戻ってやり直してください。'), 400)
    }

    try {
      const { userId, tokenStoreRef } = await deps.gmailOAuthGateway.completeAuthorization(
        state,
        code,
      )
      const now = new Date()

      const existing = await deps.gmailOAuthTokenRepository.findByUserId(userId)
      if (existing?.kind === 'revocation_detected') {
        await deps.gmailOAuthTokenRepository.save(reauthorizeToken(existing, now))
        await deps.eventBus.publish(
          GmailReauthorizationCompletedSchema.parse({
            ...domainEventBase(now),
            type: 'GmailReauthorizationCompleted',
            userId,
            reauthorizedAt: now,
          }),
        )
      } else {
        await deps.gmailOAuthTokenRepository.save(
          GmailOAuthTokenSchema.parse({
            kind: 'valid',
            userId,
            tokenStoreRef,
            authorizedAt: now,
            lastVerifiedAt: now,
          }),
        )
        await deps.eventBus.publish(
          GmailLinkCompletedSchema.parse({
            ...domainEventBase(now),
            type: 'GmailLinkCompleted',
            userId,
            authorizedAt: now,
          }),
        )
      }

      const user = await deps.appUserRepository.findById(userId)
      if (user?.kind === 'phase2_in_progress') {
        const updated = completeSectionA(user, tokenStoreRef, now)
        await deps.appUserRepository.save(updated)
        await deps.eventBus.publish(
          SectionACompletedSchema.parse({
            ...domainEventBase(now),
            type: 'SectionACompleted',
            userId,
            completedAt: now,
          }),
        )
      }

      return c.html(
        page('Gmail 連携が完了しました', 'このタブを閉じて LINE アプリに戻ってください。'),
      )
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        return c.html(page('認可を確認できませんでした', e.message), 403)
      }
      console.error('Gmail OAuth callback error:', e)
      return c.html(
        page(
          'Gmail 連携に失敗しました',
          'LINE アプリに戻ってやり直してください。解決しない場合は管理者に連絡してください。',
        ),
        500,
      )
    }
  })

  return app
}
