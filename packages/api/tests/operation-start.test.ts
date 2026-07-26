/**
 * 運用開始発火（08f §2）の適用そのもののテスト。
 * ルート経由では作りにくい途中状態（片方だけ通知有効化済み・片方だけ運用開始済み）を
 * リポジトリへ直接置いて、発火の結論と冪等性を固定する。
 */
import { describe, it, expect, vi } from 'vitest'
import {
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
