import { describe, it, expect } from 'vitest'
import {
  completePhase2,
  completeSectionA,
  completeSectionB,
  isNotificationActivated,
  lineOperationSettingsOf,
  recordLineFriendAdded,
  registerAppUser,
  startOperation,
  startPhase2,
  type AppUser,
  type OperationStartedUser,
  type Phase2CompletedUser,
} from '../../../src/onboarding-auth/aggregates/AppUser'
import { activateNotification } from '../../../src/onboarding-auth/services/activateNotification'
import { InvariantViolationError } from '../../../src/shared/errors/DomainError'
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

/**
 * 両者を運用開始済みまで進めた世帯。
 * 被テスト関数（decideOperationStart）ではなく集約の遷移関数で組み立てる
 * （判定側のバグに fixture が追随して見えなくなるのを避ける）。
 */
function startedMembers(at: Date = AT): {
  honey: OperationStartedUser
  darling: OperationStartedUser
} {
  return {
    honey: startOperation(phase2Completed('honey', { friendAdded: true }), at),
    darling: startOperation(phase2Completed('darling', { friendAdded: true }), at),
  }
}

/** 運用開始済み・通知有効化済みの世帯（世帯として発行済みとみなせる状態） */
function activatedMembers(): { honey: AppUser; darling: AppUser } {
  const started = startedMembers()
  return {
    honey: activateNotification(started.honey, joinedTalkRoom, AT),
    darling: activateNotification(started.darling, joinedTalkRoom, AT),
  }
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
    const started = startedMembers()
    const decision = decideOperationStart(started, new Date('2026-04-01T00:00:00Z'))
    expect(decision.kind).toBe('already_started')
    if (decision.kind !== 'already_started') return
    // 入力そのものが返る（再判定で運用開始日時を上書きしない）
    expect(decision.household.honey).toBe(started.honey)
    expect(decision.household.honey.operationStartedAt).toEqual(AT)
  })

  it('片方だけ保存が済んだ状態からの再実行は、残りの 1 人だけを遷移させて回復する', () => {
    const started = startedMembers()
    const retriedAt = new Date('2026-04-01T00:00:00Z')
    const decision = decideOperationStart(
      { honey: started.honey, darling: phase2Completed('darling', { friendAdded: true }) },
      retriedAt,
    )
    expect(decision.kind).toBe('start')
    if (decision.kind !== 'start') return
    expect(decision.transitioned).toHaveLength(1)
    expect(decision.transitioned[0]?.common.role).toBe('darling')
    expect(decision.transitioned[0]?.operationStartedAt).toEqual(retriedAt)
    // 既に運用開始済みだった側の運用開始日時は再実行で書き換わらない
    expect(decision.household.honey.operationStartedAt).toEqual(AT)
    // イベントに載る日時は保存される値（遅い方）から導く
    expect(decision.operationStartedAt).toEqual(retriedAt)
  })

  it('役割とスロットが食い違う世帯は判定できない（イベントの identity 取り違え防止）', () => {
    const started = startedMembers()
    expect(() =>
      decideOperationStart({ honey: started.darling, darling: started.honey }, AT),
    ).toThrow(InvariantViolationError)
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
    const decision = decideHouseholdNotificationActivation(
      activatedMembers(),
      joinedTalkRoom,
      new Date('2026-04-01T00:00:00Z'),
    )
    expect(decision.kind).toBe('activate')
    if (decision.kind !== 'activate') return
    expect(decision.changed).toHaveLength(0)
  })

  it('有効化日時は保存済みの値から導く（再判定で変わらない＝配信の冪等性キーが安定する）', () => {
    const laterAt = new Date('2026-04-01T00:00:00Z')
    const decision = decideHouseholdNotificationActivation(
      activatedMembers(),
      joinedTalkRoom,
      laterAt,
    )
    expect(decision.kind).toBe('activate')
    if (decision.kind !== 'activate') return
    // 呼出し時刻ではなく、既に保存されている有効化日時が返る
    expect(decision.activatedAt).toEqual(AT)
  })

  it('片方だけ事前に有効化済みなら、未有効化の 1 人だけが保存対象になる', () => {
    const started = startedMembers()
    const decision = decideHouseholdNotificationActivation(
      { honey: activateNotification(started.honey, joinedTalkRoom, AT), darling: started.darling },
      joinedTalkRoom,
      AT,
    )
    expect(decision.kind).toBe('activate')
    if (decision.kind !== 'activate') return
    expect(decision.changed).toHaveLength(1)
    expect(decision.changed[0]?.common.role).toBe('darling')
    expect(decision.changed.every(isNotificationActivated)).toBe(true)
  })
})

describe('世帯の通知機能が有効化済みかの判定（イベント二重発行の防止に使う）', () => {
  it('運用開始済み・参加済み・両者有効化済みなら true', () => {
    expect(isHouseholdNotificationActive(activatedMembers(), joinedTalkRoom)).toBe(true)
  })

  it('片方が未有効化なら false（発行済みとみなさない）', () => {
    const started = startedMembers()
    expect(
      isHouseholdNotificationActive(
        {
          honey: activateNotification(started.honey, joinedTalkRoom, AT),
          darling: started.darling,
        },
        joinedTalkRoom,
      ),
    ).toBe(false)
  })

  it('運用開始前は、両者が事前蓄積で有効化済みでも false（発火はこれからのため）', () => {
    // 事前蓄積（Phase1）で有効化済み・かつ運用開始前。運用開始済みの判定だけが false の理由になる
    const preActivated = (role: 'honey' | 'darling'): AppUser =>
      activateNotification(phase2Completed(role, { friendAdded: true }), joinedTalkRoom, AT)
    const members = { honey: preActivated('honey'), darling: preActivated('darling') }
    expect(members.honey.kind).toBe('phase2_completed')
    expect(isNotificationActivated(members.honey)).toBe(true)
    expect(isNotificationActivated(members.darling)).toBe(true)
    expect(isHouseholdNotificationActive(members, joinedTalkRoom)).toBe(false)
  })

  it('共通トークルーム未参加なら false（他の条件がすべて揃っていても）', () => {
    const members = activatedMembers()
    expect(isHouseholdNotificationActive(members, joinedTalkRoom)).toBe(true)
    expect(isHouseholdNotificationActive(members, NOT_JOINED_SHARED_TALK_ROOM)).toBe(false)
  })

  it('世帯のメンバーが未登録なら false', () => {
    const members = activatedMembers()
    expect(
      isHouseholdNotificationActive({ honey: members.honey, darling: null }, joinedTalkRoom),
    ).toBe(false)
  })
})
