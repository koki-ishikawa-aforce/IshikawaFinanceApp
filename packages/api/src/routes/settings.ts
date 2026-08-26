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
} from '@warimaru/domain'
import type { AppUserRepository, EventBus, UserId, UserRole } from '@warimaru/domain'
import type { AppEnv } from '../env.js'
import { domainEventBase } from '../event-handlers/index.js'
import { readJsonObjectBody } from '../read-json-object-body.js'

const NicknameBodySchema = z.object({ nickname: NicknameSchema.nullable() })

export interface SettingsRoutesDeps {
  appUserRepository: AppUserRepository
  resolveViewerRole: (viewerId: UserId) => Promise<UserRole>
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
