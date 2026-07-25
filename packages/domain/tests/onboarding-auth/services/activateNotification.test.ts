import { describe, it, expect } from 'vitest'
import {
  lineOperationSettingsOf,
  recordLineFriendAdded,
  registerAppUser,
  type Phase1CompletedUser,
} from '../../../src/onboarding-auth/aggregates/AppUser'
import {
  NOT_JOINED_SHARED_TALK_ROOM,
  recordSharedTalkRoomJoined,
} from '../../../src/onboarding-auth/aggregates/SharedTalkRoom'
import { activateNotification } from '../../../src/onboarding-auth/services/activateNotification'
import { InvariantViolationError } from '../../../src/shared/errors/DomainError'

const base = (): Phase1CompletedUser =>
  registerAppUser('line_user_honey' as never, 'honey', undefined, new Date())

/** 世帯の共通トークルーム参加済み記録（通知有効化の前提） */
const joinedTalkRoom = (at: Date) =>
  recordSharedTalkRoomJoined(NOT_JOINED_SHARED_TALK_ROOM, 'room_001' as never, at)

describe('通知機能有効化サービス（AppUser × SharedTalkRoom、OQ-55 ①）', () => {
  it('友達未追加なら有効化できない', () => {
    const at = new Date()
    expect(() => activateNotification(base(), joinedTalkRoom(at), at)).toThrow(
      InvariantViolationError,
    )
  })

  it('友達追加済みでも世帯が共通トークルーム未参加なら有効化できない', () => {
    const at = new Date()
    const friendOnly = recordLineFriendAdded(base(), at)
    expect(() => activateNotification(friendOnly, NOT_JOINED_SHARED_TALK_ROOM, at)).toThrow(
      InvariantViolationError,
    )
  })

  it('両方揃えば有効化される（記録は有効化日時のみ、#334）', () => {
    const at = new Date()
    const friendOnly = recordLineFriendAdded(base(), at)
    const activated = activateNotification(friendOnly, joinedTalkRoom(at), at)
    // toEqual は余剰キーも不一致にするため、共通トークルームID を焼き付けていないことも
    // ここで固定される（世帯レベルの記録が唯一の正、#334）
    expect(lineOperationSettingsOf(activated).notificationActivation).toEqual({
      kind: 'activated',
      activatedAt: at,
    })
  })

  it('有効化済みなら冪等（再実行しても変化しない）', () => {
    const at = new Date()
    const room = joinedTalkRoom(at)
    const activated = activateNotification(recordLineFriendAdded(base(), at), room, at)
    const again = activateNotification(activated, room, new Date('2026-08-01T00:00:00Z'))
    expect(again).toBe(activated)
  })
})
