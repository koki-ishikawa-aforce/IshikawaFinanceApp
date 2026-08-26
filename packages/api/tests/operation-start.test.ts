/**
 * 運用開始発火（08f §2）の適用そのもののテスト。
 * ルート経由では作りにくい途中状態（片方だけ通知有効化済み・片方だけ運用開始済み）を
 * リポジトリへ直接置いて、発火の結論と冪等性を固定する。
 */
import { describe, it, expect, vi } from 'vitest'
import {
  DeliveryContentSchema,
  DeliveryTargetSchema,
  activateNotification,
  completePhase2,
  completeSectionA,
  completeSectionB,
  recordLineFriendAdded,
  recordSharedTalkRoomJoined,
  registerAppUser,
  startOperation,
  startPhase2,
  NOT_JOINED_SHARED_TALK_ROOM,
  type AppUser,
  type NotificationActivated,
  type OperationStarted,
  type Phase2CompletedUser,
  type TestMessageSent,
  type UserId,
  type UserRole,
} from '@warimaru/domain'
import { createNotificationDeliveryService } from '../src/notification/delivery-service.js'
import { fireOperationStartIfReady, tryFireOperationStart } from '../src/operation-start.js'
import type { TestApp } from './helpers/test-app.js'
import { createTestApp, SPOUSE_ID, VIEWER_ID } from './helpers/test-app.js'

const AT = new Date('2026-03-01T09:00:00Z')
const TALK_ROOM_ID = 'room_test_001'

const INITIAL_BALANCE_REF = {
  smbcAccountId: '01ACC00000000000000000SMBC' as never,
  otherSavingsAccountId: '01ACC0000000000000000BANK2' as never,
  nisaAccountId: '01ACC00000000000000000N1SA' as never,
}

/** Phase2 完了まで進めたユーザー（口座の実在検証はルート側の責務のためここでは通らない） */
function phase2Completed(
  userId: UserId,
  role: UserRole,
  options: { friendAdded: boolean },
): Phase2CompletedUser {
  const registered = registerAppUser(userId, role, undefined, AT)
  const withFriend = options.friendAdded ? recordLineFriendAdded(registered, AT) : registered
  const sectionA = completeSectionA(
    startPhase2(withFriend as typeof registered),
    `/warimaru/gmail/${role}/token` as never,
    AT,
  )
  return completePhase2(completeSectionB(sectionA, INITIAL_BALANCE_REF, AT), AT)
}

interface EventLog {
  operationStarted: OperationStarted[]
  notificationActivated: NotificationActivated[]
  testMessageSent: TestMessageSent[]
}

function subscribeEvents(t: TestApp): EventLog {
  const log: EventLog = { operationStarted: [], notificationActivated: [], testMessageSent: [] }
  t.deps.eventBus.subscribe<OperationStarted>('OperationStarted', e => {
    log.operationStarted.push(e)
    return Promise.resolve()
  })
  t.deps.eventBus.subscribe<NotificationActivated>('NotificationActivated', e => {
    log.notificationActivated.push(e)
    return Promise.resolve()
  })
  t.deps.eventBus.subscribe<TestMessageSent>('TestMessageSent', e => {
    log.testMessageSent.push(e)
    return Promise.resolve()
  })
  return log
}

async function seedUsers(t: TestApp, users: readonly AppUser[]): Promise<void> {
  for (const user of users) await t.deps.appUserRepository.save(user)
}

async function joinTalkRoom(t: TestApp): Promise<void> {
  await t.deps.sharedTalkRoomRepository.save(
    recordSharedTalkRoomJoined(NOT_JOINED_SHARED_TALK_ROOM, TALK_ROOM_ID as never, AT),
  )
}

const honeyReady = (): Phase2CompletedUser =>
  phase2Completed(VIEWER_ID, 'honey', { friendAdded: true })
const darlingReady = (): Phase2CompletedUser =>
  phase2Completed(SPOUSE_ID, 'darling', { friendAdded: true })

describe('fireOperationStartIfReady', () => {
  it('世帯のメンバーが揃っていなければ何もしない', async () => {
    const t = createTestApp()
    const log = subscribeEvents(t)
    await seedUsers(t, [honeyReady()])
    await joinTalkRoom(t)

    const outcome = await fireOperationStartIfReady(t.deps, { trigger: 'phase2_complete', at: AT })
    expect(outcome).toEqual({ operation: 'not_ready', notification: 'not_ready' })
    expect(log.operationStarted).toHaveLength(0)
    expect(log.notificationActivated).toHaveLength(0)
  })

  it('条件が揃えば運用開始と世帯の通知有効化をまとめて発火する', async () => {
    const t = createTestApp()
    const log = subscribeEvents(t)
    await seedUsers(t, [honeyReady(), darlingReady()])
    await joinTalkRoom(t)

    const outcome = await fireOperationStartIfReady(t.deps, { trigger: 'phase2_complete', at: AT })
    expect(outcome).toEqual({ operation: 'started', notification: 'activated' })
    expect(log.operationStarted).toHaveLength(1)
    expect(log.notificationActivated).toHaveLength(1)
    expect(log.testMessageSent).toHaveLength(1)
    // 記録するのは呼出し時刻ではなく保存済みの有効化日時（配信の冪等性キーの一部）
    expect(await t.deps.householdNotificationActivationRepository.find()).toEqual({
      kind: 'activated',
      activatedAt: AT,
    })
  })

  it('発火済みの世帯で再実行しても何も発行しない（冪等）', async () => {
    const t = createTestApp()
    await seedUsers(t, [honeyReady(), darlingReady()])
    await joinTalkRoom(t)
    await fireOperationStartIfReady(t.deps, { trigger: 'phase2_complete', at: AT })

    const log = subscribeEvents(t)
    const outcome = await fireOperationStartIfReady(t.deps, {
      trigger: 'spouse_completion_check',
      at: new Date('2026-03-02T09:00:00Z'),
    })
    expect(outcome).toEqual({ operation: 'already_started', notification: 'already_active' })
    expect(log.operationStarted).toHaveLength(0)
    expect(log.notificationActivated).toHaveLength(0)
    expect(log.testMessageSent).toHaveLength(0)
  })

  it('片方が先に通知有効化済みでも、世帯の通知有効化イベントは発行される', async () => {
    // 事前蓄積（Phase1 の通知有効化）や、前回の発火が途中で落ちた場合に生じる状態。
    // 「本人ぶんが有効化済み」を発行済みの根拠にしてしまうと、テスト送信が永久に届かない
    const t = createTestApp()
    const log = subscribeEvents(t)
    const room = recordSharedTalkRoomJoined(NOT_JOINED_SHARED_TALK_ROOM, TALK_ROOM_ID as never, AT)
    await joinTalkRoom(t)
    await seedUsers(t, [
      activateNotification(startOperation(honeyReady(), AT), room, AT),
      startOperation(darlingReady(), AT),
    ])

    const outcome = await fireOperationStartIfReady(t.deps, {
      trigger: 'notification_activation_request',
      at: new Date('2026-03-02T09:00:00Z'),
    })
    expect(outcome).toEqual({ operation: 'already_started', notification: 'activated' })
    expect(log.notificationActivated).toHaveLength(1)
    expect(log.testMessageSent).toHaveLength(1)
  })

  it('共通トークルーム未参加なら運用開始だけを発火し、有効化は保留する', async () => {
    const t = createTestApp()
    const log = subscribeEvents(t)
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await seedUsers(t, [honeyReady(), darlingReady()])

      const outcome = await fireOperationStartIfReady(t.deps, {
        trigger: 'phase2_complete',
        at: AT,
      })
      expect(outcome).toEqual({ operation: 'started', notification: 'not_ready' })
      expect(log.operationStarted).toHaveLength(1)
      expect(log.notificationActivated).toHaveLength(0)
      expect(warned).toHaveBeenCalledWith(expect.stringContaining('talk_room_not_joined'))
    } finally {
      warned.mockRestore()
    }
  })

  it('後から前提が揃えば、次の発火で通知有効化まで進む（回復）', async () => {
    const t = createTestApp()
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await seedUsers(t, [honeyReady(), darlingReady()])
      await fireOperationStartIfReady(t.deps, { trigger: 'phase2_complete', at: AT })

      const log = subscribeEvents(t)
      await joinTalkRoom(t)
      const outcome = await fireOperationStartIfReady(t.deps, {
        trigger: 'shared_talk_room_joined',
        at: new Date('2026-03-02T09:00:00Z'),
      })
      expect(outcome).toEqual({ operation: 'already_started', notification: 'activated' })
      expect(log.notificationActivated).toHaveLength(1)
      expect(log.testMessageSent).toHaveLength(1)
    } finally {
      warned.mockRestore()
    }
  })

  it('テスト送信の依頼が失敗した回は、次の発火でやり直す（#447）', async () => {
    // per-user の有効化は保存されるが、世帯の有効化記録は発行が成功して初めて書く。
    // 記録の有無ではなく per-user の状態から「もう送った」を推測していた頃は、
    // この回のテストメッセージがその世帯へ二度と送られなかった
    const t = createTestApp()
    await seedUsers(t, [honeyReady(), darlingReady()])
    await joinTalkRoom(t)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const publish = t.deps.eventBus.publish.bind(t.deps.eventBus)
    t.deps.eventBus.publish = (event): Promise<void> =>
      event.type === 'NotificationActivated'
        ? Promise.reject(new Error('publish failed'))
        : publish(event)
    try {
      await expect(
        fireOperationStartIfReady(t.deps, { trigger: 'phase2_complete', at: AT }),
      ).rejects.toThrow('publish failed')
      // 「自動では再発行されない」から「次の発火の起点で再試行される」へ意味が反転した記録
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('次の発火の起点で再試行される'))
    } finally {
      t.deps.eventBus.publish = publish
      logged.mockRestore()
    }

    const log = subscribeEvents(t)
    const outcome = await fireOperationStartIfReady(t.deps, {
      trigger: 'spouse_completion_check',
      at: new Date('2026-03-02T09:00:00Z'),
    })
    expect(outcome).toEqual({ operation: 'already_started', notification: 'activated' })
    expect(log.notificationActivated).toHaveLength(1)
    expect(log.testMessageSent).toHaveLength(1)
    // 有効化日時は保存済みの per-user の値から導くため、やり直しでも変わらない
    // （配信側の冪等性キーがずれて同じメッセージが二重に届くことを防ぐ）
    expect(log.notificationActivated[0]?.activatedAt).toEqual(AT)
  })

  it('配信ログだけが既に確定している世帯は、テストメッセージを二重に送らず記録が追いつく（#590）', async () => {
    // マイグレーション直後や #590 以前からの移行など、「LINE への配信は既に確定しているが
    // 世帯通知有効化記録がまだ無い」状態を、イベントを介さず配信ログだけ直接作って再現する
    // （イベント経由だと、その publish 自体が本ハンドラーチェーンを通って記録まで書いてしまう）
    const t = createTestApp()
    const room = recordSharedTalkRoomJoined(NOT_JOINED_SHARED_TALK_ROOM, TALK_ROOM_ID as never, AT)
    await joinTalkRoom(t)
    await seedUsers(t, [
      activateNotification(startOperation(honeyReady(), AT), room, AT),
      activateNotification(startOperation(darlingReady(), AT), room, AT),
    ])
    const idempotencyKey = `test_message:${TALK_ROOM_ID}:${AT.toISOString()}`
    await createNotificationDeliveryService(t.deps).deliver({
      target: DeliveryTargetSchema.parse({ kind: 'shared_talk_room', talkRoomId: TALK_ROOM_ID }),
      content: DeliveryContentSchema.parse({ kind: 'plain_text', textBody: '過去の配信の再現' }),
      purpose: 'test_message',
      idempotencyKey,
    })
    expect(
      await t.deps.lineDeliveryLogRepository.findAllByIdempotencyKey(idempotencyKey),
    ).toHaveLength(1)
    expect(await t.deps.householdNotificationActivationRepository.find()).toEqual({
      kind: 'not_activated',
    })

    const log = subscribeEvents(t)
    const outcome = await fireOperationStartIfReady(t.deps, {
      trigger: 'spouse_completion_check',
      at: new Date('2026-03-02T09:00:00Z'),
    })
    expect(outcome).toEqual({ operation: 'already_started', notification: 'activated' })
    expect(log.notificationActivated).toHaveLength(1)
    // 配信ログは増えない（実際の LINE 送信は再び起きない。冪等性キーで止まる）
    expect(
      await t.deps.lineDeliveryLogRepository.findAllByIdempotencyKey(idempotencyKey),
    ).toHaveLength(1)
    // 冪等スキップでも配信確定として TestMessageSent は発行される（#590）
    expect(log.testMessageSent).toHaveLength(1)
    // これで初めて世帯通知有効化記録が書かれる
    expect(await t.deps.householdNotificationActivationRepository.find()).toEqual({
      kind: 'activated',
      activatedAt: AT,
    })
  })

  it('世帯通知有効化記録の保存に失敗しても、呼出し元には伝播せず次の発火で回復する（#590）', async () => {
    // 記録の保存は配信確定を検知した購読側（TestMessageSent の safeSubscribe）で行うため、
    // 失敗してもログに残るだけで fireOperationStartIfReady 自体は失敗しない
    // （通知配信の送信失敗が呼出し元に伝播しないのと同じ扱い）
    const t = createTestApp()
    await seedUsers(t, [honeyReady(), darlingReady()])
    await joinTalkRoom(t)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const save = t.deps.householdNotificationActivationRepository.save.bind(
      t.deps.householdNotificationActivationRepository,
    )
    t.deps.householdNotificationActivationRepository.save = (): Promise<void> =>
      Promise.reject(new Error('save failed'))
    try {
      const outcome = await fireOperationStartIfReady(t.deps, {
        trigger: 'phase2_complete',
        at: AT,
      })
      expect(outcome).toEqual({ operation: 'started', notification: 'activated' })
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('TestMessageSent'),
        expect.anything(),
      )
    } finally {
      t.deps.householdNotificationActivationRepository.save = save
      logged.mockRestore()
    }
    // 実際の LINE 送信までは完了しているが、記録はまだ無い
    expect(await t.deps.householdNotificationActivationRepository.find()).toEqual({
      kind: 'not_activated',
    })

    const log = subscribeEvents(t)
    await fireOperationStartIfReady(t.deps, {
      trigger: 'spouse_completion_check',
      at: new Date('2026-03-02T09:00:00Z'),
    })
    expect(log.notificationActivated).toHaveLength(1)
    // 冪等性キーは変わらないため実際の LINE 送信は増えない
    expect(
      await t.deps.lineDeliveryLogRepository.findAllByIdempotencyKey(
        `test_message:${TALK_ROOM_ID}:${AT.toISOString()}`,
      ),
    ).toHaveLength(1)
    // 冪等スキップでも配信確定として TestMessageSent は再発行され、今度は記録が書かれる
    expect(log.testMessageSent).toHaveLength(1)
    expect(await t.deps.householdNotificationActivationRepository.find()).toEqual({
      kind: 'activated',
      activatedAt: AT,
    })
  })

  it('発行に成功した世帯は、per-user の状態に関わらず再発行しない（#447）', async () => {
    const t = createTestApp()
    await seedUsers(t, [honeyReady(), darlingReady()])
    await joinTalkRoom(t)
    await fireOperationStartIfReady(t.deps, { trigger: 'phase2_complete', at: AT })

    const log = subscribeEvents(t)
    // 世帯の記録が唯一の根拠であることを示すため、per-user の有効化を巻き戻した状態で再発火する
    await seedUsers(t, [startOperation(honeyReady(), AT), startOperation(darlingReady(), AT)])
    const outcome = await fireOperationStartIfReady(t.deps, {
      trigger: 'line_friend_added',
      at: new Date('2026-03-02T09:00:00Z'),
    })
    expect(outcome).toEqual({ operation: 'already_started', notification: 'already_active' })
    expect(log.notificationActivated).toHaveLength(0)
    expect(log.testMessageSent).toHaveLength(0)
  })

  it('発行に失敗したら呼出し元へ伝播する（黙って落とさない）', async () => {
    const t = createTestApp()
    await seedUsers(t, [honeyReady(), darlingReady()])
    await joinTalkRoom(t)
    t.deps.eventBus.publish = (): Promise<void> => Promise.reject(new Error('publish failed'))

    await expect(
      fireOperationStartIfReady(t.deps, { trigger: 'phase2_complete', at: AT }),
    ).rejects.toThrow('publish failed')
  })
})

describe('tryFireOperationStart', () => {
  it('発火に失敗しても呼出し元へは投げ返さず、失敗を記録する', async () => {
    const t = createTestApp()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await seedUsers(t, [honeyReady(), darlingReady()])
      await joinTalkRoom(t)
      t.deps.eventBus.publish = (): Promise<void> => Promise.reject(new Error('publish failed'))

      await expect(
        tryFireOperationStart(t.deps, { trigger: 'phase2_complete', at: AT }),
      ).resolves.toBeUndefined()
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('trigger=phase2_complete'))
    } finally {
      logged.mockRestore()
    }
  })
})
