/**
 * 設定エンドポイント（#48、プロフィール設定）
 * @see docs/superpowers/specs/2026-05-01-phase3.5-ux-ui-design.md §13.1
 *
 * オンボーディング（/api/onboarding）とは責務を分離した、運用開始後の設定変更用
 * エンドポイント（#48 の設計決定）。役割は変更不可、ニックネームは本人のみ変更可。
 */
import { Hono } from 'hono'
import { z } from 'zod'
import {
  NicknameChangedSchema,
  NicknameSchema,
  NotFoundError,
  changeNickname,
  resolveSpouseUserId,
} from '@warimaru/domain'
import type {
  Allowlist,
  AppUserRepository,
  EventBus,
  GmailOAuthTokenRepository,
  UserId,
  UserRole,
} from '@warimaru/domain'
import type { AppEnv } from '../env.js'
import { domainEventBase } from '../event-handlers/index.js'
import { readJsonObjectBody } from '../read-request-body.js'

const NicknameBodySchema = z.object({ nickname: NicknameSchema.nullable() })

export interface SettingsRoutesDeps {
  appUserRepository: AppUserRepository
  gmailOAuthTokenRepository: GmailOAuthTokenRepository
  resolveViewerRole: (viewerId: UserId) => Promise<UserRole>
  fetchAllowlist: () => Promise<Allowlist>
  eventBus: EventBus
}

export function settingsRoutes(deps: SettingsRoutesDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  /** 自分のプロフィール（役割は変更不可の参照値。未登録でもロールは許可リストから解決する） */
  app.get('/profile', async c => {
    const viewerId = c.get('viewerId')
    const user = await deps.appUserRepository.findById(viewerId)
    const role = user?.common.role ?? (await deps.resolveViewerRole(viewerId))
    return c.json({
      profile: { userId: viewerId, role, nickname: user?.common.nickname ?? null },
    })
  })

  /**
   * 自分の Gmail 連携状態（#392、設定画面の Gmail 連携タブが読む）。
   *
   * 返すのは閲覧者本人の連携状態のみ（相手の連携状態は返さない — 個人の外部連携は
   * プライバシー3段階ルールの「個人」に準じて本人だけが見る）。日時を添えるのは、
   * 失効通知の DM を後から開いた利用者が「いつから止まっているか」を画面で確かめる
   * ため。トークンの保管参照（Parameter Store パス）は画面に不要なので露出しない。
   */
  app.get('/gmail-link', async c => {
    const viewerId = c.get('viewerId')
    const token = await deps.gmailOAuthTokenRepository.findByUserId(viewerId)
    if (token === null) {
      return c.json({ gmailLink: { kind: 'not_linked' } })
    }
    return c.json({
      gmailLink:
        token.kind === 'valid'
          ? { kind: 'valid', authorizedAt: token.authorizedAt.toISOString() }
          : {
              kind: 'revocation_detected',
              revocationDetectedAt: token.revocationDetectedAt.toISOString(),
            },
    })
  })

  /**
   * 相手（配偶者）のニックネーム。残高画面・ダッシュボードが相手の呼び名（ニックネーム、
   * 未設定ならロール名フォールバック）を出すために読む(#596)。相手のロールは画面側が
   * 確定済みの自分のロールから導出できるためここでは返さない（相手の userId も返さない）。
   * 相手が未登録（AppUser 行が無い）なら nickname は null。
   */
  app.get('/spouse-profile', async c => {
    const viewerId = c.get('viewerId')
    const allowlist = await deps.fetchAllowlist()
    const spouseUserId = resolveSpouseUserId(viewerId, allowlist)
    const spouseUser = await deps.appUserRepository.findById(spouseUserId)
    return c.json({
      profile: { nickname: spouseUser?.common.nickname ?? null },
    })
  })

  /** ニックネームの変更（本人のみ。null で未設定に戻す = ロール名フォールバック表示） */
  app.put('/nickname', async c => {
    const body = NicknameBodySchema.parse(readJsonObjectBody(await c.req.text()))
    const viewerId = c.get('viewerId')
    const user = await deps.appUserRepository.findById(viewerId)
    if (user === null) throw new NotFoundError('AppUser', viewerId)
    const now = new Date()
    const oldNickname = user.common.nickname
    const updated = changeNickname(user, body.nickname ?? undefined)
    await deps.appUserRepository.save(updated)
    await deps.eventBus.publish(
      NicknameChangedSchema.parse({
        ...domainEventBase(now),
        type: 'NicknameChanged',
        userId: viewerId,
        ...(oldNickname !== undefined ? { oldNickname } : {}),
        ...(body.nickname !== null ? { newNickname: body.nickname } : {}),
      }),
    )
    return c.json({
      profile: {
        userId: viewerId,
        role: updated.common.role,
        nickname: updated.common.nickname ?? null,
      },
    })
  })

  return app
}
