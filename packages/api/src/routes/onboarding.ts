/**
 * オンボーディング エンドポイント（#41、オンボーディング・認証コンテキスト）
 * @see docs/domain/08f-ul-オンボーディング認証.md §2
 *
 * - 進捗の永続化は AppUser 集約（localStorage 暫定実装の置き換え先）
 * - viewer 本人の集約のみ操作する（ニックネーム等の「本人のみ変更可」は viewerId で担保）
 * - 配偶者完了検知は画面ロード時のみ判定（論点19: ポーリング / WebSocket なし）
 * - Gmail OAuth コールバックは LIFF セッション外で到達するため routes/gmail-oauth.ts が担う
 */
import { Hono } from 'hono'
import { z } from 'zod'
import {
  AccessDeniedSchema,
  AppUserRegisteredSchema,
  ImportJobIdSchema,
  InitialBalanceRegistrationRefSchema,
  InvariantViolationError,
  LineFriendAddedSchema,
  LineTalkRoomJoinedSchema,
  NicknameChangedSchema,
  NicknameSchema,
  NotFoundError,
  OauthAuthorizationStartedSchema,
  PermissionDeniedError,
  Phase2CompletedSchema,
  Phase2StartedSchema,
  RoleJudgedSchema,
  SectionBCompletedSchema,
  SectionFCompletedSchema,
  SectionFSkippedSchema,
  TalkRoomIdSchema,
  activateNotification,
  changeNickname,
  completePhase2,
  completeSectionB,
  completeSectionF,
  judgeRole,
  recordLineFriendAdded,
  recordTalkRoomJoined,
  registerAppUser,
  skipSectionF,
  startPhase2,
} from '@warimaru/domain'
import type {
  AllowlistQuery,
  AppUser,
  AppUserRepository,
  EventBus,
  GmailOAuthGateway,
  Phase2InProgressUser,
  SpouseCompletionQuery,
  UserId,
} from '@warimaru/domain'
import type { AppEnv } from '../env.js'
import { domainEventBase } from '../event-handlers/index.js'

const RegisterBodySchema = z.object({ nickname: NicknameSchema.optional() })
const NicknameBodySchema = z.object({ nickname: NicknameSchema.nullable() })
const TalkRoomBodySchema = z.object({ talkRoomId: TalkRoomIdSchema })
const SectionBBodySchema = z.object({ initialBalanceRef: InitialBalanceRegistrationRefSchema })
const SectionFBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('completed'), importJobId: ImportJobIdSchema }),
  z.object({ kind: z.literal('skipped') }),
])

export interface OnboardingRoutesDeps {
  appUserRepository: AppUserRepository
  spouseCompletionQuery: SpouseCompletionQuery
  allowlistQuery: AllowlistQuery
  gmailOAuthGateway: GmailOAuthGateway
  eventBus: EventBus
}

export function onboardingRoutes(deps: OnboardingRoutesDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()

  async function getUserOr404(viewerId: UserId): Promise<AppUser> {
    const user = await deps.appUserRepository.findById(viewerId)
    if (user === null) throw new NotFoundError('AppUser', viewerId)
    return user
  }

  function asPhase2InProgress(user: AppUser): Phase2InProgressUser {
    if (user.kind !== 'phase2_in_progress') {
      throw new InvariantViolationError(`Phase2 進行中ではない（現状態: ${user.kind}）`)
    }
    return user
  }

  /** 自分の AppUser（Phase / 進捗）の取得。未登録なら user: null */
  app.get('/me', async c => {
    const user = await deps.appUserRepository.findById(c.get('viewerId'))
    return c.json({ user })
  })

  /**
   * アプリユーザーの新規登録（Phase1: 役割判定 + 登録、05-scenario-b §Phase1）。
   * 許可リスト不一致は 403（P1-2）。登録済みなら現状を返す冪等操作。
   */
  app.post('/register', async c => {
    const body = RegisterBodySchema.parse(await c.req.json().catch(() => ({})))
    const viewerId = c.get('viewerId')
    const existing = await deps.appUserRepository.findById(viewerId)
    if (existing !== null) return c.json({ user: existing })

    const now = new Date()
    const judgment = judgeRole(viewerId, await deps.allowlistQuery.fetch(), now)
    await deps.eventBus.publish(
      RoleJudgedSchema.parse({
        ...domainEventBase(now),
        type: 'RoleJudged',
        lineUserId: viewerId,
        result: judgment,
      }),
    )
    if (judgment.kind === 'rejected') {
      await deps.eventBus.publish(
        AccessDeniedSchema.parse({
          ...domainEventBase(now),
          type: 'AccessDenied',
          lineUserId: viewerId,
          reason: judgment.reason,
        }),
      )
      throw new PermissionDeniedError('このアプリは特定ユーザー専用です（許可リスト不一致）')
    }

    const user = registerAppUser(viewerId, judgment.role, body.nickname, now)
    await deps.appUserRepository.save(user)
    await deps.eventBus.publish(
      AppUserRegisteredSchema.parse({
        ...domainEventBase(now),
        type: 'AppUserRegistered',
        userId: viewerId,
        role: judgment.role,
      }),
    )
    return c.json({ user }, 201)
  })

  /** ニックネームの設定（本人のみ変更可。null で未設定 = ロール名表示に戻す） */
  app.put('/nickname', async c => {
    const body = NicknameBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const user = await getUserOr404(viewerId)
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
    return c.json({ user: updated })
  })

  /** Phase1: LINE 友だち追加の完了記録（冪等） */
  app.post('/phase1/line-friend', async c => {
    const viewerId = c.get('viewerId')
    const user = await getUserOr404(viewerId)
    const now = new Date()
    const updated = recordLineFriendAdded(user, now)
    if (updated !== user) {
      await deps.appUserRepository.save(updated)
      await deps.eventBus.publish(
        LineFriendAddedSchema.parse({
          ...domainEventBase(now),
          type: 'LineFriendAdded',
          userId: viewerId,
          receivedAt: now,
        }),
      )
    }
    return c.json({ user: updated })
  })

  /**
   * Phase1: 共通トークルーム参加の完了記録（冪等）。
   * 暫定: talkRoomId は Web（LIFF context）からの自己申告。共通トークルームID の正は
   * join Webhook（08f §2）であり、LINE Webhook 受信ルートの実装時にそちらを正とする
   * （フォローアップ Issue で追跡）。
   */
  app.post('/phase1/talk-room', async c => {
    const body = TalkRoomBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const user = await getUserOr404(viewerId)
    const now = new Date()
    const updated = recordTalkRoomJoined(user, body.talkRoomId, now)
    if (updated !== user) {
      await deps.appUserRepository.save(updated)
      await deps.eventBus.publish(
        LineTalkRoomJoinedSchema.parse({
          ...domainEventBase(now),
          type: 'LineTalkRoomJoined',
          talkRoomId: body.talkRoomId,
          receivedAt: now,
        }),
      )
    }
    return c.json({ user: updated })
  })

  /**
   * Phase1: 通知有効化の完了記録（友だち追加 + トークルーム参加が前提。冪等）。
   * NotificationActivated イベント（世帯レベル、通知配信のテスト送信を起動）は
   * ここでは発行しない — 08f §2 のとおり両者の運用開始が揃った時点（運用開始発火、
   * 本 Issue のスコープ外）で一元発行する。
   */
  app.post('/phase1/notification', async c => {
    const viewerId = c.get('viewerId')
    const user = await getUserOr404(viewerId)
    const now = new Date()
    const updated = activateNotification(user, now)
    if (updated !== user) {
      await deps.appUserRepository.save(updated)
    }
    return c.json({ user: updated })
  })

  /** Phase2 の開始（Phase1完了 → Phase2進行中。進行中なら冪等に現状を返す） */
  app.post('/phase2/start', async c => {
    const viewerId = c.get('viewerId')
    const user = await getUserOr404(viewerId)
    if (user.kind === 'phase2_in_progress') return c.json({ user })
    if (user.kind !== 'phase1_completed') {
      throw new InvariantViolationError(
        `Phase1 完了状態ではないため Phase2 を開始できない（現状態: ${user.kind}）`,
      )
    }
    const now = new Date()
    const updated = startPhase2(user)
    await deps.appUserRepository.save(updated)
    await deps.eventBus.publish(
      Phase2StartedSchema.parse({
        ...domainEventBase(now),
        type: 'Phase2Started',
        userId: viewerId,
        startedAt: now,
      }),
    )
    return c.json({ user: updated }, 201)
  })

  /**
   * Phase2 SectionB（初期残高登録参照の記録）。
   * SectionA 完了前は 409（論点8: 順序強制、集約側の不変条件）。
   * SectionA の完了は Gmail OAuth コールバック（routes/gmail-oauth.ts）が記録する。
   */
  app.put('/phase2/section-b', async c => {
    const body = SectionBBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const user = asPhase2InProgress(await getUserOr404(viewerId))
    const now = new Date()
    const updated = completeSectionB(user, body.initialBalanceRef, now)
    await deps.appUserRepository.save(updated)
    await deps.eventBus.publish(
      SectionBCompletedSchema.parse({
        ...domainEventBase(now),
        type: 'SectionBCompleted',
        userId: viewerId,
        completedAt: now,
      }),
    )
    return c.json({ user: updated })
  })

  /** Phase2 SectionF（過去明細取込）の完了またはスキップ */
  app.put('/phase2/section-f', async c => {
    const body = SectionFBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const user = asPhase2InProgress(await getUserOr404(viewerId))
    const now = new Date()
    if (body.kind === 'completed') {
      const updated = completeSectionF(user, body.importJobId, now)
      await deps.appUserRepository.save(updated)
      await deps.eventBus.publish(
        SectionFCompletedSchema.parse({
          ...domainEventBase(now),
          type: 'SectionFCompleted',
          userId: viewerId,
          importJobId: body.importJobId,
        }),
      )
      return c.json({ user: updated })
    }
    const updated = skipSectionF(user, now)
    await deps.appUserRepository.save(updated)
    await deps.eventBus.publish(
      SectionFSkippedSchema.parse({
        ...domainEventBase(now),
        type: 'SectionFSkipped',
        userId: viewerId,
        skippedAt: now,
      }),
    )
    return c.json({ user: updated })
  })

  /** Phase2 の完了（SectionA/B 完了が前提。完了済みなら冪等に現状を返す） */
  app.post('/phase2/complete', async c => {
    const viewerId = c.get('viewerId')
    const user = await getUserOr404(viewerId)
    if (user.kind === 'phase2_completed' || user.kind === 'operation_started') {
      return c.json({ user })
    }
    const now = new Date()
    const updated = completePhase2(asPhase2InProgress(user), now)
    await deps.appUserRepository.save(updated)
    await deps.eventBus.publish(
      Phase2CompletedSchema.parse({
        ...domainEventBase(now),
        type: 'Phase2Completed',
        userId: viewerId,
        completedAt: now,
      }),
    )
    return c.json({ user: updated }, 201)
  })

  /** 配偶者完了検知（論点19: 画面ロード時のみ判定） */
  app.get('/spouse-completion', async c => {
    const result = await deps.spouseCompletionQuery.check(c.get('viewerId'))
    return c.json(result)
  })

  /** Gmail OAuth 認可 URL の発行（SectionA。liff.openWindow({external: true}) で開く、OQ-7） */
  app.post('/gmail/authorize', async c => {
    const viewerId = c.get('viewerId')
    await getUserOr404(viewerId)
    const now = new Date()
    const authorizationUrl = await deps.gmailOAuthGateway.buildAuthorizationUrl(viewerId)
    await deps.eventBus.publish(
      OauthAuthorizationStartedSchema.parse({
        ...domainEventBase(now),
        type: 'OauthAuthorizationStarted',
        userId: viewerId,
        startedAt: now,
      }),
    )
    return c.json({ authorizationUrl })
  })

  return app
}
