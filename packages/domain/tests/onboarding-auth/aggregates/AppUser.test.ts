import { describe, it, expect } from 'vitest'
import {
  AppUserSchema,
  startPhase2,
  completePhase2,
  startOperation,
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
    smbcAccountId: 'acc_smbc' as never,
    otherSavingsAccountId: 'acc_other' as never,
    nisaAccountId: 'acc_nisa' as never,
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
    expect(completed.initialBalanceRef.nisaAccountId).toBe('acc_nisa')

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
