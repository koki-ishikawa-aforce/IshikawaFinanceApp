import { describe, it, expect } from 'vitest'
import {
  completePhase2,
  completeSectionA,
  completeSectionB,
  isNotificationActivated,
  lineOperationSettingsOf,
  recordLineFriendAdded,
  registerAppUser,
  startPhase2,
  type AppUser,
  type Phase2CompletedUser,
} from '../../../src/onboarding-auth/aggregates/AppUser'
import {
  NOT_JOINED_SHARED_TALK_ROOM,
  recordSharedTalkRoomJoined,
} from '../../../src/onboarding-auth/aggregates/SharedTalkRoom'
import type { UserRole } from '../../../src/shared/value-objects/UserRole'
import {
  decideHouseholdNotificationActivation,
  decideOperationStart,
  isHouseholdNotificationActive,
} from '../../../src/onboarding-auth/services/decideOperationStart'

const AT = new Date('2026-03-01T09:00:00Z')

const INITIAL_BALANCE_REF = {
  smbcAccountId: '01ACC00000000000000000SMBC' as never,
  otherSavingsAccountId: '01ACC0000000000000000BANK2' as never,
  nisaAccountId: '01ACC00000000000000000N1SA' as never,
}

const joinedTalkRoom = recordSharedTalkRoomJoined(
  NOT_JOINED_SHARED_TALK_ROOM,
  'room_001' as never,
  AT,
)

/** Phase2 完了まで進めたユーザー（friendAdded: 友達追加を記録済みにするか） */
function phase2Completed(role: UserRole, options: { friendAdded: boolean }): Phase2CompletedUser {
  const registered = registerAppUser(`line_user_${role}` as never, role, undefined, AT)
  const withFriend = options.friendAdded ? recordLineFriendAdded(registered, AT) : registered
  const inProgress = startPhase2(withFriend as typeof registered)
  const sectionA = completeSectionA(inProgress, `/warimaru/gmail/${role}/token` as never, AT)
  return completePhase2(completeSectionB(sectionA, INITIAL_BALANCE_REF, AT), AT)
}

/** 両者 Phase2 完了・友達追加済みの世帯 */
function readyMembers(): { honey: AppUser; darling: AppUser } {
  return {
    honey: phase2Completed('honey', { friendAdded: true }),
    darling: phase2Completed('darling', { friendAdded: true }),
  }
}

/** 両者を運用開始済みまで進めた世帯 */
function startedMembers(): { honey: AppUser; darling: AppUser } {
  const decision = decideOperationStart(readyMembers(), AT)
  if (decision.kind !== 'start') throw new Error('前提: 運用開始が発火すること')
  return decision.household
}

describe('運用開始発火の判定（08f §2「運用開始を発火する」、論点16）', () => {
  it('両者の Phase2 完了が揃えば両者が運用開始済みへ遷移する', () => {
    const decision = decideOperationStart(readyMembers(), AT)
    expect(decision.kind).toBe('start')
    if (decision.kind !== 'start') return
    expect(decision.household.honey.kind).toBe('operation_started')
    expect(decision.household.darling.kind).toBe('operation_started')
    expect(decision.transitioned).toHaveLength(2)
    expect(decision.operationStartedAt).toEqual(AT)
    // 事前蓄積した LINE 運用設定が集約直下へ昇格している（common 側からは除去、#334）
    expect(decision.household.honey.common.lineOperationSettings).toBeUndefined()
    expect(lineOperationSettingsOf(decision.household.honey).friendAdd.kind).toBe('added')
  })

  it('片方のみ Phase2 完了では発火しない（否定形）', () => {
    const honey = phase2Completed('honey', { friendAdded: true })
    const darling = startPhase2(
      registerAppUser('line_user_darling' as never, 'darling', undefined, AT),
    )
    const decision = decideOperationStart({ honey, darling }, AT)
    expect(decision).toEqual({ kind: 'not_ready', blocker: 'phase2_incomplete' })
  })

  it('配偶者が未登録では発火しない（否定形）', () => {
    const decision = decideOperationStart(
      { honey: phase2Completed('honey', { friendAdded: true }), darling: null },
      AT,
    )
    expect(decision).toEqual({ kind: 'not_ready', blocker: 'member_unregistered' })
  })

  it('両者とも運用開始済みなら already_started（再実行しても遷移しない＝冪等）', () => {
    const decision = decideOperationStart(startedMembers(), new Date('2026-04-01T00:00:00Z'))
    expect(decision.kind).toBe('already_started')
  })

  it('片方だけ保存が済んだ状態からの再実行は、残りの 1 人だけを遷移させて回復する', () => {
    const started = startedMembers()
    const decision = decideOperationStart(
      { honey: started.honey, darling: phase2Completed('darling', { friendAdded: true }) },
      AT,
    )
    expect(decision.kind).toBe('start')
    if (decision.kind !== 'start') return
    expect(decision.transitioned).toHaveLength(1)
    expect(decision.transitioned[0]?.common.role).toBe('darling')
  })
})

describe('世帯の通知機能有効化の判定（08f §2「通知機能を有効化する」）', () => {
  it('両者運用開始済み・友達追加済み・共通トークルーム参加済みで有効化される', () => {
    const decision = decideHouseholdNotificationActivation(startedMembers(), joinedTalkRoom, AT)
    expect(decision.kind).toBe('activate')
    if (decision.kind !== 'activate') return
    expect(decision.talkRoomId).toBe('room_001')
    expect(decision.activatedAt).toEqual(AT)
    expect(decision.changed).toHaveLength(2)
    expect(decision.changed.every(isNotificationActivated)).toBe(true)
  })

  it('運用開始前は有効化しない（否定形）', () => {
    const decision = decideHouseholdNotificationActivation(readyMembers(), joinedTalkRoom, AT)
    expect(decision).toEqual({ kind: 'not_ready', blocker: 'operation_not_started' })
  })

  it('世帯が共通トークルーム未参加なら有効化しない（配信先が決まらない、否定形）', () => {
    const decision = decideHouseholdNotificationActivation(
      startedMembers(),
      NOT_JOINED_SHARED_TALK_ROOM,
      AT,
    )
    expect(decision).toEqual({ kind: 'not_ready', blocker: 'talk_room_not_joined' })
  })

  it('片方が友達未追加なら有効化しない（否定形）', () => {
    const decision = decideOperationStart(
      {
        honey: phase2Completed('honey', { friendAdded: true }),
        darling: phase2Completed('darling', { friendAdded: false }),
      },
      AT,
    )
    if (decision.kind !== 'start') throw new Error('前提: 運用開始が発火すること')
    expect(decideHouseholdNotificationActivation(decision.household, joinedTalkRoom, AT)).toEqual({
      kind: 'not_ready',
      blocker: 'friend_not_added',
    })
  })

  it('事前蓄積で既に有効化済みのユーザーは保存対象に含まれない（冪等）', () => {
    const first = decideHouseholdNotificationActivation(startedMembers(), joinedTalkRoom, AT)
    if (first.kind !== 'activate') throw new Error('前提: 有効化されること')
    const again = decideHouseholdNotificationActivation(
      { honey: first.changed[0] ?? null, darling: first.changed[1] ?? null },
      joinedTalkRoom,
      new Date('2026-04-01T00:00:00Z'),
    )
    expect(again.kind).toBe('activate')
    if (again.kind !== 'activate') return
    expect(again.changed).toHaveLength(0)
  })
})

describe('世帯の通知機能が有効化済みかの判定（イベント二重発行の防止に使う）', () => {
  it('運用開始済み・参加済み・両者有効化済みなら true', () => {
    const decision = decideHouseholdNotificationActivation(startedMembers(), joinedTalkRoom, AT)
    if (decision.kind !== 'activate') throw new Error('前提: 有効化されること')
    const members = { honey: decision.changed[0] ?? null, darling: decision.changed[1] ?? null }
    expect(isHouseholdNotificationActive(members, joinedTalkRoom)).toBe(true)
  })

  it('片方が未有効化なら false（発行済みとみなさない）', () => {
    const started = startedMembers()
    const decision = decideHouseholdNotificationActivation(started, joinedTalkRoom, AT)
    if (decision.kind !== 'activate') throw new Error('前提: 有効化されること')
    expect(
      isHouseholdNotificationActive(
        { honey: decision.changed[0] ?? null, darling: started.darling },
        joinedTalkRoom,
      ),
    ).toBe(false)
  })

  it('運用開始前は両者有効化済みでも false（発火はこれからのため）', () => {
    const members = readyMembers()
    expect(isHouseholdNotificationActive(members, joinedTalkRoom)).toBe(false)
  })

  it('共通トークルーム未参加なら false', () => {
    expect(isHouseholdNotificationActive(startedMembers(), NOT_JOINED_SHARED_TALK_ROOM)).toBe(false)
  })
})
