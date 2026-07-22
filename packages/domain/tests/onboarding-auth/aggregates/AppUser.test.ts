import { describe, it, expect } from 'vitest'
import {
  AppUserSchema,
  startPhase2,
  completePhase2,
  startOperation,
  registerAppUser,
  changeNickname,
  lineSettingsOf,
  recordLineFriendAdded,
  recordTalkRoomJoined,
  activateNotification,
  completeSectionA,
  completeSectionB,
  completeSectionF,
  skipSectionF,
  type Phase1CompletedUser,
  type Phase2InProgressUser,
} from '../../../src/onboarding-auth/aggregates/AppUser'
import { InvariantViolationError } from '../../../src/shared/errors/DomainError'

const common = {
  userId: 'line_user_honey' as never,
  role: 'honey',
  nickname: 'はに' as never,
  firstRegisteredAt: new Date(),
}

const emptyProgress = {
  sectionA: { kind: 'not_started' },
  sectionB: { kind: 'not_started' },
  sectionC: { kind: 'unconfirmed' },
  sectionD: { kind: 'unconfirmed' },
  sectionE: { kind: 'unconfirmed' },
  sectionF: { kind: 'not_started' },
}

const sectionACompleted = {
  kind: 'completed',
  tokenStoreRef: '/warimaru/gmail/honey/token' as never,
  completedAt: new Date(),
}
const sectionBCompleted = {
  kind: 'completed',
  initialBalanceRef: {
    smbcAccountId: '01ACC00000000000000000SMBC' as never,
    otherSavingsAccountId: '01ACC0000000000000000BANK2' as never,
    nisaAccountId: '01ACC00000000000000000N1SA' as never,
  },
  completedAt: new Date(),
}

describe('AppUser 集約', () => {
  it('Phase1完了ユーザー（ニックネーム未設定も可）は parse 成功', () => {
    expect(() => AppUserSchema.parse({ kind: 'phase1_completed', common })).not.toThrow()
    const noNickname: Record<string, unknown> = { ...common }
    delete noNickname['nickname']
    expect(() =>
      AppUserSchema.parse({ kind: 'phase1_completed', common: noNickname }),
    ).not.toThrow()
  })

  it('ニックネームが 11 文字以上なら parse 失敗（Phase 3.5: ≤10 文字）', () => {
    expect(() =>
      AppUserSchema.parse({
        kind: 'phase1_completed',
        common: { ...common, nickname: 'あいうえおかきくけこさ' as never },
      }),
    ).toThrow()
  })

  it('役割が Honey / Darling 以外なら parse 失敗', () => {
    expect(() =>
      AppUserSchema.parse({ kind: 'phase1_completed', common: { ...common, role: 'husband' } }),
    ).toThrow()
  })

  it('SectionA 未完了で SectionB 完了は parse 失敗（論点8: 順序強制）', () => {
    expect(() =>
      AppUserSchema.parse({
        kind: 'phase2_in_progress',
        common,
        progress: { ...emptyProgress, sectionB: sectionBCompleted },
      }),
    ).toThrow()
  })

  it('SectionB 未完了で SectionC 確認は parse 失敗（論点8）', () => {
    expect(() =>
      AppUserSchema.parse({
        kind: 'phase2_in_progress',
        common,
        progress: {
          ...emptyProgress,
          sectionA: sectionACompleted,
          sectionC: { kind: 'confirmed', confirmedAt: new Date() },
        },
      }),
    ).toThrow()
  })

  it('A → B → C の順に進んだ進捗は parse 成功', () => {
    expect(() =>
      AppUserSchema.parse({
        kind: 'phase2_in_progress',
        common,
        progress: {
          ...emptyProgress,
          sectionA: sectionACompleted,
          sectionB: sectionBCompleted,
          sectionC: { kind: 'confirmed', confirmedAt: new Date() },
        },
      }),
    ).not.toThrow()
  })

  it('completePhase2: SectionA/B 未完なら InvariantViolationError', () => {
    const phase1 = AppUserSchema.parse({
      kind: 'phase1_completed',
      common,
    }) as Phase1CompletedUser
    const inProgress = startPhase2(phase1)
    expect(() => completePhase2(inProgress, new Date())).toThrow(InvariantViolationError)
  })

  it('completePhase2: A/B 完了済みなら成功し、トークン参照と初期残高参照を引き継ぐ', () => {
    const inProgress = AppUserSchema.parse({
      kind: 'phase2_in_progress',
      common,
      progress: {
        ...emptyProgress,
        sectionA: sectionACompleted,
        sectionB: sectionBCompleted,
      },
    }) as Phase2InProgressUser
    const completed = completePhase2(inProgress, new Date())
    expect(completed.kind).toBe('phase2_completed')
    expect(completed.gmailTokenRef.tokenStoreRef).toBe('/warimaru/gmail/honey/token')
    expect(completed.initialBalanceRef.nisaAccountId).toBe('01ACC00000000000000000N1SA')

    const operating = startOperation(
      completed,
      {
        friendAdd: { kind: 'added', followWebhookReceivedAt: new Date() },
        talkRoomJoin: {
          kind: 'joined',
          talkRoomId: 'room_001' as never,
          joinWebhookReceivedAt: new Date(),
        },
        notificationActivation: {
          kind: 'activated',
          talkRoomId: 'room_001' as never,
          activatedAt: new Date(),
        },
      },
      new Date(),
    )
    expect(operating.kind).toBe('operation_started')
  })
})

describe('registerAppUser / changeNickname（#41）', () => {
  it('未登録 → Phase1完了ユーザーを生成する（ニックネーム省略可）', () => {
    const at = new Date()
    const user = registerAppUser('line_user_honey' as never, 'honey', undefined, at)
    expect(user.kind).toBe('phase1_completed')
    expect(user.common.nickname).toBeUndefined()
    expect(user.common.firstRegisteredAt.getTime()).toBe(at.getTime())

    const named = registerAppUser('line_user_darling' as never, 'darling', 'だー' as never, at)
    expect(named.common.nickname).toBe('だー')
  })

  it('changeNickname は設定・解除（ロール名フォールバック）の両方ができる', () => {
    const user = registerAppUser('line_user_honey' as never, 'honey', undefined, new Date())
    const named = changeNickname(user, 'はにー' as never)
    expect(named.common.nickname).toBe('はにー')
    const cleared = changeNickname(named, undefined)
    expect(cleared.common.nickname).toBeUndefined()
  })
})

describe('LINE 運用設定の事前蓄積（#41）', () => {
  const base = (): Phase1CompletedUser =>
    registerAppUser('line_user_honey' as never, 'honey', undefined, new Date())

  it('未設定の lineSettings は全状態未着手として読める', () => {
    const settings = lineSettingsOf(base())
    expect(settings.friendAdd.kind).toBe('not_added')
    expect(settings.talkRoomJoin.kind).toBe('not_joined')
    expect(settings.notificationActivation.kind).toBe('not_activated')
  })

  it('友達追加の記録は冪等（追加済みなら日時を上書きしない）', () => {
    const first = new Date('2026-07-01T00:00:00Z')
    const added = recordLineFriendAdded(base(), first)
    const again = recordLineFriendAdded(added, new Date('2026-07-02T00:00:00Z'))
    const settings = lineSettingsOf(again)
    expect(settings.friendAdd).toEqual({ kind: 'added', followWebhookReceivedAt: first })
  })

  it('通知有効化は友達追加とトークルーム参加の完了が前提', () => {
    const at = new Date()
    expect(() => activateNotification(base(), at)).toThrow(InvariantViolationError)

    const friendOnly = recordLineFriendAdded(base(), at)
    expect(() => activateNotification(friendOnly, at)).toThrow(InvariantViolationError)

    const joined = recordTalkRoomJoined(friendOnly, 'room_001' as never, at)
    const activated = activateNotification(joined, at)
    const settings = lineSettingsOf(activated)
    expect(settings.notificationActivation).toEqual({
      kind: 'activated',
      talkRoomId: 'room_001',
      activatedAt: at,
    })
  })

  it('lineSettings は Phase 遷移（startPhase2）を越えて引き継がれる', () => {
    const user = recordLineFriendAdded(base(), new Date()) as Phase1CompletedUser
    const inProgress = startPhase2(user)
    expect(lineSettingsOf(inProgress).friendAdd.kind).toBe('added')
  })
})

describe('Phase2 セクション遷移関数（#41）', () => {
  const inProgress = (): Phase2InProgressUser =>
    startPhase2(registerAppUser('line_user_honey' as never, 'honey', undefined, new Date()))

  it('SectionA 未完了で completeSectionB は InvariantViolationError（論点8）', () => {
    expect(() =>
      completeSectionB(inProgress(), sectionBCompleted.initialBalanceRef as never, new Date()),
    ).toThrow(InvariantViolationError)
  })

  it('SectionA → SectionB の順に完了できる（再認可による A の再完了も可）', () => {
    const at = new Date()
    const a = completeSectionA(inProgress(), '/warimaru/gmail/honey/token' as never, at)
    expect(a.progress.sectionA.kind).toBe('completed')

    const reauth = completeSectionA(a, '/warimaru/gmail/honey/token-v2' as never, at)
    expect(
      reauth.progress.sectionA.kind === 'completed' && reauth.progress.sectionA.tokenStoreRef,
    ).toBe('/warimaru/gmail/honey/token-v2')

    const b = completeSectionB(reauth, sectionBCompleted.initialBalanceRef as never, at)
    expect(b.progress.sectionB.kind).toBe('completed')
  })

  it('SectionF はスキップ → 完了のやり直しは可、完了 → スキップは不可', () => {
    const at = new Date()
    const skipped = skipSectionF(inProgress(), at)
    expect(skipped.progress.sectionF.kind).toBe('skipped')

    const completed = completeSectionF(skipped, '01HZZZZZZZZZZZZZZZZZZZZZZZ' as never, at)
    expect(completed.progress.sectionF.kind).toBe('completed')

    expect(() => skipSectionF(completed, at)).toThrow(InvariantViolationError)
  })
})
