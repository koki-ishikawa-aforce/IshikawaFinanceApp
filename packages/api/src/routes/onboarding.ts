/**
 * オンボーディング エンドポイント（#41、オンボーディング・認証コンテキスト）
 * @see docs/domain/08f-ul-オンボーディング認証.md §2
 *
 * - 進捗の永続化は AppUser 集約（localStorage 暫定実装の置き換え先）
 * - viewer 本人の集約のみ操作する（ニックネーム等の「本人のみ変更可」は viewerId で担保）
 * - 配偶者完了検知は画面ロード時のみ判定（論点19: ポーリング / WebSocket なし）
 * - Gmail OAuth コールバックは LIFF セッション外で到達するため routes/gmail-oauth.ts が担う
 */
import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  AccessDeniedSchema,
  AppUserRegisteredSchema,
  ImportJobIdSchema,
  InitialBalanceRegistrationRefSchema,
  InvariantViolationError,
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
  lineOperationSettingsOf,
  registerAppUser,
  skipSectionF,
  startPhase2,
} from '@warimaru/domain'
import type {
  AccountId,
  AccountKind,
  AccountRepository,
  AllowlistQuery,
  AppUser,
  AppUserRepository,
  EventBus,
  GmailOAuthGateway,
  InitialBalanceRegistrationRef,
  LineFriendshipGateway,
  Phase2InProgressUser,
  SharedTalkRoomRepository,
  SpouseCompletionQuery,
  UserId,
} from '@warimaru/domain'
import type { AppEnv } from '../env.js'
import { domainEventBase } from '../event-handlers/index.js'
import { applyLineFriendAdded, applySharedTalkRoomJoined } from '../line-operation-records.js'
import { fireOperationStartIfReady, tryFireOperationStart } from '../operation-start.js'

const RegisterBodySchema = z.object({ nickname: NicknameSchema.optional() })
const NicknameBodySchema = z.object({ nickname: NicknameSchema.nullable() })
const TalkRoomBodySchema = z.object({ talkRoomId: TalkRoomIdSchema })
const SectionBBodySchema = z.object({ initialBalanceRef: InitialBalanceRegistrationRefSchema })
const SectionFBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('completed'), importJobId: ImportJobIdSchema }),
  z.object({ kind: z.literal('skipped') }),
])

/**
 * ログ用の短縮識別子。LINE userID は個人を辿れる識別子（PII）のためそのままは出さず、
 * 復元できない形へ潰したうえで「同時刻の別ユーザーと区別できる」最小限だけを残す。
 */
function traceIdOf(userId: UserId): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 8)
}

/**
 * 友だち追加の確認結果（画面向け）。ドメインの友達状態照会結果（08f §2）を、記録まで済ませた
 * うえでの結末へ写したもの:
 *
 *  - `confirmed`: 友だち追加が記録されている（今回の照会で記録した場合と、既に記録済みだった場合）
 *  - `not_friend`: 照会できたが、まだ友だち追加されていない
 *  - `unavailable`: 照会そのものができなかった（API 障害・通信断・トークン解決失敗）
 */
type FriendshipCheckResultKind = 'confirmed' | 'not_friend' | 'unavailable'

export interface OnboardingRoutesDeps {
  appUserRepository: AppUserRepository
  /** 共通トークルーム参加状態の「正」（世帯レベル、OQ-55 ①） */
  sharedTalkRoomRepository: SharedTalkRoomRepository
  /** SectionB の事前条件「初期残高が登録された」を残高・資産推移管理コンテキスト越しに照合する */
  accountRepository: AccountRepository
  spouseCompletionQuery: SpouseCompletionQuery
  allowlistQuery: AllowlistQuery
  gmailOAuthGateway: GmailOAuthGateway
  /** 登録完了時の友だち状態照会（OQ-55 ③。登録前 follow の取りこぼしを拾い直す） */
  lineFriendshipGateway: LineFriendshipGateway
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

  /**
   * LINE の友だち状態を照会し、既に友だち追加済みなら記録する（OQ-55 ③）。
   *
   * 登録より前に友だち追加した場合、その follow Webhook は宛先のアプリユーザーが未登録のため
   * 記録されず破棄される（routes/line-webhook.ts）。自己申告 API は廃止される（OQ-55 ②）ので、
   * この照会が取りこぼしを拾い直す唯一の経路になる。
   *
   * 照会の失敗・記録の失敗はいずれも呼び出し元の操作を失敗させない。登録経路では登録そのものが
   * 既に永続化されており、ここで 5xx を返すと利用者から見て登録できていないのと区別がつかなくなる。
   *
   * **失敗した回の回復には照会し直す経路が要る**。follow Webhook は友だち追加（またはブロック
   * 解除）の瞬間にしか発生しないため、登録前に友だち追加していたユーザーへ再送されることはなく、
   * Webhook を回復経路として当てにはできない。回復経路は 2 つあり、どちらも未記録である限り
   * 毎回照会し直す（記録済みなら照会しないので、外部 API を叩き続けることにはならない）:
   *
   *  - 登録要求（新規登録の成立直後、および登録済みの冪等な再要求）
   *  - セットアップ画面からの明示的な確認（`POST /phase1/line-friend/check`、#417 A）。
   *    自己申告 API の廃止（#298）後、利用者が自力で立て直せる唯一の入口になる
   *
   * 返り値の `result` は画面へ返す確認結果で、ドメインの友達状態照会結果（08f §2）を
   * 「記録済み（confirmed） / 友だちでなかった（not_friend） / 照会できなかった（unavailable）」
   * へ写したもの。`not_friend` と `unavailable` を区別するのは、案内すべき次の行動が
   * 「LINE で友だち追加する」と「通信状況を確かめてやり直す」で異なるため。
   */
  async function checkAndRecordFriendAdded(
    user: AppUser,
    at: Date,
  ): Promise<{ user: AppUser; result: FriendshipCheckResultKind }> {
    const userId = user.common.userId
    if (lineOperationSettingsOf(user).friendAdd.kind === 'added') {
      return { user, result: 'confirmed' }
    }
    try {
      const status = await deps.lineFriendshipGateway.checkFriendship(userId)
      if (status.kind === 'unknown') {
        console.error(
          `LINE 友だち状態の照会に失敗した（${status.detail}, user=${traceIdOf(userId)}）— 次の登録要求または画面からの確認で再照会する`,
        )
        return { user, result: 'unavailable' }
      }
      if (status.kind === 'not_friend') return { user, result: 'not_friend' }
      // 照会の待ち時間中に follow Webhook が同じ事実を記録している可能性がある。古いスナップ
      // ショットへ適用すると `recordLineFriendAdded` の冪等判定が効かず、再保存と
      // LineFriendAdded の二重発行、および記録日時の上書きが起きるため、最新を読み直す
      const latest = (await deps.appUserRepository.findById(userId)) ?? user
      return { user: await applyLineFriendAdded(deps, latest, at), result: 'confirmed' }
    } catch (e) {
      // 照会・記録のどちらで落ちても呼び出し元の操作は成立させる。LINE userID は PII のため
      // ログに出さず、復元不能な短縮識別子だけを添えて「誰の照会で失敗したか」を追えるようにする
      console.error(
        `LINE 友だち追加の記録に失敗した（${e instanceof Error ? e.name : 'unknown'}, user=${traceIdOf(userId)}）— 次の登録要求または画面からの確認で再照会する`,
      )
      // 保存は成功しイベント発行で落ちた可能性があるため、応答は永続化されている最新に揃える。
      // 記録が残っているなら確認は成立しており、画面を「確認できなかった」に倒さない
      const latest = await deps.appUserRepository.findById(userId).catch(() => null)
      const settled = latest ?? user
      return {
        user: settled,
        result:
          lineOperationSettingsOf(settled).friendAdd.kind === 'added' ? 'confirmed' : 'unavailable',
      }
    }
  }

  /**
   * SectionB の事前条件「初期残高が登録された」（08f §2）をコンテキスト越しに検証する。
   * initialBalanceRef が指す 3 口座について、残高・資産推移管理コンテキストとの参照整合性を
   * application 層で照合する（ドメイン不変条件の再実装ではなく、境界づけられたコンテキスト間の
   * 参照整合性チェック）:
   *
   *  - 実在: 口座が実在する（口座は登録と同時に初期残高を持つため、実在 = 初期残高登録済み。08d §2）
   *  - 種別一致: 口座種別がフィールドの期待種別（smbcAccountId → smbc_bank /
   *    otherSavingsAccountId → other_savings / nisaAccountId → nisa）と一致する。
   *    3 種別は互いに異なるため、同一 ID を複数フィールドに重複指定した場合も本チェックで弾かれる
   *  - 所有者一致: 3 口座とも viewer 本人所有（`ownerUserId === viewerId`）である。夫婦はそれぞれ
   *    自分名義の SMBC 銀行・別銀行貯蓄・NISA 口座を持つ（01-overview.md §3、
   *    05-scenario-b §Section B「自分名義の SMBC 普通預金残高」）ため、配偶者名義の口座 ID を
   *    自分の初期残高として参照することを防ぐ。とりわけ SMBC 残高は本人のみ可視で秘匿性が最も
   *    高い（05-scenario-b P2-B5）ため、所有者照合は SMBC を含む 3 口座すべてに課す。
   *
   * いずれの不整合も NotFoundError（404）に翻訳する。#78 が確立した実在不在（404）と契約を揃え、
   * かつ「不在」「種別違い」「配偶者口座」を呼び出し側から区別させないことで、他者口座の存在を
   * 探る（プロービング）余地を残さない。
   */
  async function assertReferencedAccountsValid(
    ref: InitialBalanceRegistrationRef,
    viewerId: UserId,
  ): Promise<void> {
    const expectations: { accountId: AccountId; kind: AccountKind }[] = [
      { accountId: ref.smbcAccountId, kind: 'smbc_bank' },
      { accountId: ref.otherSavingsAccountId, kind: 'other_savings' },
      { accountId: ref.nisaAccountId, kind: 'nisa' },
    ]
    for (const { accountId, kind } of expectations) {
      const account = await deps.accountRepository.findById(accountId)
      if (account === null) throw new NotFoundError('Account', accountId)
      if (account.kind !== kind) throw new NotFoundError('Account', accountId)
      if (account.common.ownerUserId !== viewerId) {
        throw new NotFoundError('Account', accountId)
      }
    }
  }

  /**
   * 自分の AppUser（Phase / 進捗）の取得。未登録なら user: null。
   * 共通トークルーム参加状態は世帯にひとつの事実（OQ-55 ①）のため、per-user の集約とは
   * 別に世帯レベルの記録を併せて返す（画面のセットアップ手順の判定に使う）。
   */
  app.get('/me', async c => {
    const user = await deps.appUserRepository.findById(c.get('viewerId'))
    const sharedTalkRoom = await deps.sharedTalkRoomRepository.find()
    return c.json({ user, sharedTalkRoom })
  })

  /**
   * アプリユーザーの新規登録（Phase1: 役割判定 + 登録、05-scenario-b §Phase1）。
   * 許可リスト不一致は 403（P1-2）。登録済みなら現状を返す冪等操作。
   * 新規登録・冪等呼び出しのいずれでも、友だち追加が未記録なら LINE の友だち状態を照会して
   * 登録前の友だち追加を拾い直す（OQ-55 ③。照会が失敗した回を次の呼び出しで回復するため、
   * 新規登録の瞬間だけには限定しない）。
   */
  app.post('/register', async c => {
    const body = RegisterBodySchema.parse(await c.req.json().catch(() => ({})))
    const viewerId = c.get('viewerId')
    const now = new Date()
    const existing = await deps.appUserRepository.findById(viewerId)
    // 登録済みでも友だち追加が未記録なら照会し直す（前回の照会が失敗した回をここで回復する）
    if (existing !== null) {
      return c.json({ user: (await checkAndRecordFriendAdded(existing, now)).user })
    }

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
    // 登録より前に友だち追加していた場合の取りこぼしを、ここで拾い直す（OQ-55 ③）
    const registered = await checkAndRecordFriendAdded(user, now)
    return c.json({ user: registered.user }, 201)
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

  /**
   * Phase1: LINE 友だち追加の確認をやり直す（#417 A。冪等）。
   *
   * 友だち状態の照会は登録要求の中でも行うが、画面は登録要求を初回しか送らないため、その回の
   * 照会が失敗したユーザーは友だち未追加の扱いのまま止まり、通知の設定へ進めなくなる。自己申告
   * ボタンの廃止（#298）でその逃げ道も無くなるため、利用者が自分でやり直せる入口をここに置く。
   *
   * 照会できなかった場合も 200 で結果を返す。「友だちでなかった（LINE で友だち追加すればよい）」
   * と「照会できなかった（通信状況を確かめてやり直す）」では案内すべき次の行動が異なり、
   * どちらもエラー応答に倒すと画面から区別できなくなるため。失敗の理由はサーバー側のログに残す。
   */
  app.post('/phase1/line-friend/check', async c => {
    const viewerId = c.get('viewerId')
    const user = await getUserOr404(viewerId)
    const checked = await checkAndRecordFriendAdded(user, new Date())
    return c.json({ user: checked.user, result: { kind: checked.result } })
  })

  /** Phase1: LINE 友だち追加の完了記録（冪等。自己申告のため #298 で廃止する） */
  app.post('/phase1/line-friend', async c => {
    const viewerId = c.get('viewerId')
    const user = await getUserOr404(viewerId)
    const now = new Date()
    const updated = await applyLineFriendAdded(deps, user, now)
    return c.json({ user: updated })
  })

  /**
   * Phase1: 共通トークルーム参加の完了記録（冪等）。
   * 暫定: talkRoomId は Web（LIFF context）からの自己申告。共通トークルームID の正は
   * join Webhook（08f §2）であり、その受信ルート（`/webhook/line`、#296）は実装済み。
   * 本 API は移行期間の互換のために残しており、廃止は #298 で行う。
   * Webhook 由来の記録は既存の参加記録を上書きしない（配信先の差し替え防止。routes/line-webhook.ts）
   * ため、参加先の変更（招待し直し）は現状この LIFF 認証つき経路が担う。
   * 保存先は世帯レベルの SharedTalkRoom 1 か所（OQ-55 ①）。per-user の LINE 運用設定へは
   * 書き込まない（二重管理の防止）。
   */
  app.post('/phase1/talk-room', async c => {
    const body = TalkRoomBodySchema.parse(await c.req.json())
    const viewerId = c.get('viewerId')
    const user = await getUserOr404(viewerId)
    const now = new Date()
    const current = await deps.sharedTalkRoomRepository.find()
    const updated = await applySharedTalkRoomJoined(deps, current, body.talkRoomId, now)
    return c.json({ user, sharedTalkRoom: updated })
  })

  /**
   * Phase1: 通知有効化の完了記録（友だち追加 + 世帯の共通トークルーム参加が前提。冪等）。
   * NotificationActivated イベント（世帯レベル、通知配信のテスト送信を起動）はここでは発行しない
   * — 08f §2 のとおり両者の運用開始が揃った時点で一元発行する（`fireOperationStartIfReady`）。
   * ここが記録するのは運用開始前に事前蓄積する per-user の有効化状態（08f §1 実装ノート）。
   *
   * 運用開始発火を先に呼ぶ理由: 世帯としての有効化済み判定は per-user の有効化状態の合成で表す
   * （世帯レベルの記録を持たない）ため、本人ぶんだけを先に有効化すると、運用開始済みの世帯では
   * 「発行済み」と誤認されてテスト送信が起きなくなる。先に発火させれば、条件が揃った回に
   * 世帯としての有効化とイベント発行がまとめて行われる。
   */
  app.post('/phase1/notification', async c => {
    const viewerId = c.get('viewerId')
    await getUserOr404(viewerId)
    const now = new Date()
    await fireOperationStartIfReady(deps, { trigger: 'notification_activation_request', at: now })
    const user = await getUserOr404(viewerId)
    const sharedTalkRoom = await deps.sharedTalkRoomRepository.find()
    const updated = activateNotification(user, sharedTalkRoom, now)
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
    // SectionA 完了（順序強制）をドメインで検証したうえで、参照先口座の参照整合性を照合する。
    // completeSectionB は純粋関数のため、404 の場合は永続化前に中断される。
    const updated = completeSectionB(user, body.initialBalanceRef, now)
    await assertReferencedAccountsValid(body.initialBalanceRef, viewerId)
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

  /**
   * Phase2 の完了（SectionA/B 完了が前提。完了済みなら冪等に現状を返す）。
   * 自分の完了で夫婦両方が揃うなら、ここが運用開始の発火点になる（08f §2、論点16）。
   * 相方が後から完了した場合は自分の再要求（冪等な 200）でも拾い直す。
   * 応答は発火後の状態を返す（発火していれば運用開始済み）。
   */
  app.post('/phase2/complete', async c => {
    const viewerId = c.get('viewerId')
    const user = await getUserOr404(viewerId)
    const now = new Date()
    if (user.kind === 'phase2_completed' || user.kind === 'operation_started') {
      await tryFireOperationStart(deps, { trigger: 'phase2_complete', at: now })
      return c.json({ user: await getUserOr404(viewerId) })
    }
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
    await tryFireOperationStart(deps, { trigger: 'phase2_complete', at: now })
    return c.json({ user: await getUserOr404(viewerId) }, 201)
  })

  /**
   * 配偶者完了検知（論点19: 画面ロード時のみ判定）。
   * 相方の完了はポーリングしないため、遅れて開いた側のこの画面ロードが運用開始の唯一の検知機会に
   * なる（08f §2「事後: 両者完了済み なら運用開始発火を準備」）。参照系だが発火の副作用を持つのは
   * このため。発火は冪等で、条件が揃っていなければ何も起きない。
   *
   * 発火は登録済みの viewer からの要求に限る。ID トークンの検証（lineAuthMiddleware）が保証するのは
   * 「LINE Login チャネルの正当なユーザーであること」までで、世帯の 2 人であることまでは見ない。
   * 世帯の状態遷移と LINE への外部送信を起こす副作用を、許可リストを通っていない第三者が
   * 叩けるままにはしない（参照そのものは従来どおり誰でも 200 を返す）。
   */
  app.get('/spouse-completion', async c => {
    const viewerId = c.get('viewerId')
    if ((await deps.appUserRepository.findById(viewerId)) !== null) {
      await tryFireOperationStart(deps, { trigger: 'spouse_completion_check' })
    }
    const result = await deps.spouseCompletionQuery.check(viewerId)
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
