import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import {
  AccountSchema,
  BALANCE_INPUT_LIMIT,
  addNisaContributionBySmbcTransfer,
  addOtherSavingsBySmbcTransfer,
  applyOtherSavingsBalanceChange,
  applyOtherSavingsMovement,
  applySmbcBalanceChange,
  applyUnpaidSettlementToSmbcBalance,
  asNisaAccount,
  asOtherSavingsAccount,
  changeBankName,
  changeBrokerageName,
  correctInitialBalance,
  correctNisaContribution,
  correctOtherSavingsBalance,
  inactivateAccount,
  reactivateAccount,
  registerMitsuiSumitomoCardAccount,
  registerNisaAccount,
  registerOtherSavingsAccount,
  registerSmbcBankAccount,
  withdrawOtherSavings,
  type Account,
  type NisaAccount,
  type OtherSavingsAccount,
  type SmbcBankAccount,
} from '../../../src/balance-asset-tracking/aggregates/Account'
import {
  InvariantViolationError,
  OtherSavingsMovementAlreadyAppliedError,
  PermissionDeniedError,
  UnpaidSettlementAlreadyAppliedError,
} from '../../../src/shared/errors/DomainError'

const baseCommon = {
  accountId: '01ACC000000000000000000001' as never,
  ownerUserId: 'user_honey' as never,
  registeredAt: new Date(),
  activeness: { kind: 'active' as const },
}

describe('Account 集約', () => {
  it('SMBC 銀行口座を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'smbc_bank',
        common: baseCommon,
        balance: {
          currentBalance: 100000 as never,
          initialBalance: 100000 as never,
          initialBalanceBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      }),
    ).not.toThrow()
  })

  it('三井住友カード口座を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'mitsui_sumitomo_card',
        common: baseCommon,
        unpaidAggregateRef: '01NP0000000000000000000001' as never,
      }),
    ).not.toThrow()
  })

  it('別銀行貯蓄口座（銀行名付き、Phase 3.5）を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'other_savings',
        common: baseCommon,
        bankName: '楽天銀行' as never,
        balance: {
          currentBalance: 500000 as never,
          initialBalance: 500000 as never,
          initialBalanceBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
        freshnessSource: { lastUpdatedAt: new Date() },
      }),
    ).not.toThrow()
  })

  it('NISA 口座（証券会社名付き、Phase 3.5）を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'nisa',
        common: baseCommon,
        brokerageName: { kind: 'sbi' },
        contribution: {
          currentAccumulated: 200000 as never,
          initialAccumulated: 0 as never,
          initialAccumulatedBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      }),
    ).not.toThrow()
  })

  it('NISA 口座でカスタム証券会社名を parse できる', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'nisa',
        common: baseCommon,
        brokerageName: { kind: 'other', customName: 'マネックス証券' },
        contribution: {
          currentAccumulated: 100000 as never,
          initialAccumulated: 0 as never,
          initialAccumulatedBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      }),
    ).not.toThrow()
  })

  it('非アクティブ状態の口座も表現可能', () => {
    expect(() =>
      AccountSchema.parse({
        kind: 'smbc_bank',
        common: {
          ...baseCommon,
          activeness: {
            kind: 'inactive',
            inactivatedAt: new Date(),
            reason: '使わなくなったため',
          },
        },
        balance: {
          currentBalance: 0 as never,
          initialBalance: 100000 as never,
          initialBalanceBaselineAt: new Date(),
          lastUpdatedAt: new Date(),
        },
      }),
    ).not.toThrow()
  })
})

// --- #48: 口座登録（設定画面 / オンボーディング Phase 2-B） ---

describe('registerSmbcBankAccount()', () => {
  const at = new Date('2026-07-01')
  const register = (initialBalance: number) =>
    registerSmbcBankAccount({
      accountId: '01ACC000000000000000000001' as never,
      ownerUserId: 'user_honey' as never,
      initialBalance: initialBalance as never,
      at,
    })

  it('アクティブ状態で登録され、現在残高 = 初期残高になる', () => {
    const account = register(1500000)
    expect(account.kind).toBe('smbc_bank')
    expect(account.common.activeness.kind).toBe('active')
    expect(account.common.registeredAt).toEqual(at)
    expect(account.balance.currentBalance).toBe(1500000)
    expect(account.balance.initialBalance).toBe(1500000)
  })

  it('初期残高基準時刻・最終更新日時 = 登録日時（論点9）', () => {
    const account = register(1500000)
    expect(account.balance.initialBalanceBaselineAt).toEqual(at)
    expect(account.balance.lastUpdatedAt).toEqual(at)
  })

  it('反映済み引落確定通知IDは空で始まる（登録直後は何も消し込んでいない）', () => {
    expect(register(1500000).balance.appliedSettlementNoticeIds).toEqual([])
  })

  it('残高 0 円でも登録できる', () => {
    expect(register(0).balance.currentBalance).toBe(0)
  })

  it('負の初期残高は登録できない', () => {
    expect(() => register(-1)).toThrow(InvariantViolationError)
  })

  it('上限を超える初期残高は登録できない（桁の打ち間違い）', () => {
    expect(() => register(BALANCE_INPUT_LIMIT + 1)).toThrow(ZodError)
    expect(register(BALANCE_INPUT_LIMIT).balance.currentBalance).toBe(BALANCE_INPUT_LIMIT)
  })
})

describe('registerMitsuiSumitomoCardAccount()', () => {
  const at = new Date('2026-07-01')
  const register = () =>
    registerMitsuiSumitomoCardAccount({
      accountId: '01ACC000000000000000000002' as never,
      ownerUserId: 'user_honey' as never,
      unpaidAggregateRef: '01NP0000000000000000000001' as never,
      at,
    })

  it('アクティブ状態で登録され、開設済みの未払金集約を参照する', () => {
    const account = register()
    expect(account.kind).toBe('mitsui_sumitomo_card')
    expect(account.common.activeness.kind).toBe('active')
    expect(account.common.registeredAt).toEqual(at)
    expect(account.unpaidAggregateRef).toBe('01NP0000000000000000000001')
  })

  it('未払金集約参照が ULID でなければ登録できない（参照先不在の口座を作らせない）', () => {
    expect(() =>
      registerMitsuiSumitomoCardAccount({
        accountId: '01ACC000000000000000000002' as never,
        ownerUserId: 'user_honey' as never,
        unpaidAggregateRef: '' as never,
        at,
      }),
    ).toThrow(ZodError)
  })
})

describe('registerOtherSavingsAccount()', () => {
  const at = new Date('2026-07-01')
  const register = () =>
    registerOtherSavingsAccount({
      accountId: '01ACC000000000000000000002' as never,
      ownerUserId: 'user_honey' as never,
      bankName: '楽天銀行' as never,
      initialBalance: 500000 as never,
      at,
    })

  it('アクティブ状態で登録され、現在残高 = 初期残高になる', () => {
    const account = register()
    expect(account.kind).toBe('other_savings')
    expect(account.common.activeness.kind).toBe('active')
    expect(account.common.registeredAt).toEqual(at)
    expect(account.balance.currentBalance).toBe(500000)
    expect(account.balance.initialBalance).toBe(500000)
  })

  it('初期残高基準時刻・最終更新日時・残高鮮度根拠 = 登録日時（論点9）', () => {
    const account = register()
    expect(account.balance.initialBalanceBaselineAt).toEqual(at)
    expect(account.balance.lastUpdatedAt).toEqual(at)
    expect(account.freshnessSource.lastUpdatedAt).toEqual(at)
  })

  it('空の銀行名は登録できない（BankName の不変条件）', () => {
    expect(() =>
      registerOtherSavingsAccount({
        accountId: '01ACC000000000000000000002' as never,
        ownerUserId: 'user_honey' as never,
        bankName: '' as never,
        initialBalance: 0 as never,
        at,
      }),
    ).toThrow()
  })

  it('負の初期残高・上限超えは登録できない（後修正と同じ入力制約）', () => {
    const withBalance = (initialBalance: number) =>
      registerOtherSavingsAccount({
        accountId: '01ACC000000000000000000002' as never,
        ownerUserId: 'user_honey' as never,
        bankName: '楽天銀行' as never,
        initialBalance: initialBalance as never,
        at,
      })
    expect(() => withBalance(-1)).toThrow(InvariantViolationError)
    expect(() => withBalance(BALANCE_INPUT_LIMIT + 1)).toThrow(ZodError)
  })
})

describe('registerNisaAccount()', () => {
  const at = new Date('2026-07-01')

  it('アクティブ状態で登録され、現在累計 = 初期累計・基準時刻 = 登録日時になる', () => {
    const account = registerNisaAccount({
      accountId: '01ACC000000000000000000003' as never,
      ownerUserId: 'user_darling' as never,
      brokerageName: { kind: 'sbi' },
      initialAccumulated: 200000 as never,
      at,
    })
    expect(account.kind).toBe('nisa')
    expect(account.common.activeness.kind).toBe('active')
    expect(account.contribution.currentAccumulated).toBe(200000)
    expect(account.contribution.initialAccumulated).toBe(200000)
    expect(account.contribution.initialAccumulatedBaselineAt).toEqual(at)
    expect(account.contribution.lastUpdatedAt).toEqual(at)
  })

  it('その他証券会社は任意名で登録できる', () => {
    const account = registerNisaAccount({
      accountId: '01ACC000000000000000000003' as never,
      ownerUserId: 'user_darling' as never,
      brokerageName: { kind: 'other', customName: 'マネックス証券' },
      initialAccumulated: 0 as never,
      at,
    })
    expect(account.brokerageName).toEqual({ kind: 'other', customName: 'マネックス証券' })
  })

  it('負の初期累計・上限超えは登録できない（後修正と同じ入力制約）', () => {
    const withAccumulated = (initialAccumulated: number) =>
      registerNisaAccount({
        accountId: '01ACC000000000000000000003' as never,
        ownerUserId: 'user_darling' as never,
        brokerageName: { kind: 'sbi' },
        initialAccumulated: initialAccumulated as never,
        at: new Date('2026-07-01'),
      })
    expect(() => withAccumulated(-1)).toThrow(InvariantViolationError)
    expect(() => withAccumulated(BALANCE_INPUT_LIMIT + 1)).toThrow(ZodError)
  })
})

// --- #48: 銀行名・証券会社名の変更（Phase 3.5） ---

describe('changeBankName()', () => {
  const otherSavings = () =>
    AccountSchema.parse({
      kind: 'other_savings',
      common: baseCommon,
      bankName: '楽天銀行' as never,
      balance: {
        currentBalance: 500000 as never,
        initialBalance: 500000 as never,
        initialBalanceBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
      freshnessSource: { lastUpdatedAt: new Date('2026-04-01') },
    }) as OtherSavingsAccount

  it('銀行名だけが変わり、残高・鮮度根拠は変更されない', () => {
    const updated = changeBankName(
      otherSavings(),
      '住信SBIネット銀行' as never,
      'user_honey' as never,
    )
    expect(updated.bankName).toBe('住信SBIネット銀行')
    expect(updated.balance).toEqual(otherSavings().balance)
    expect(updated.freshnessSource).toEqual(otherSavings().freshnessSource)
    expect(updated.common).toEqual(otherSavings().common)
  })

  it('空の銀行名には変更できない（BankName の不変条件）', () => {
    expect(() => changeBankName(otherSavings(), '' as never, 'user_honey' as never)).toThrow()
  })

  it('所有者本人以外の操作は PermissionDeniedError（配偶者の口座名は変更不可）', () => {
    expect(() =>
      changeBankName(otherSavings(), '住信SBIネット銀行' as never, 'user_darling' as never),
    ).toThrow(PermissionDeniedError)
  })
})

describe('changeBrokerageName()', () => {
  const nisa = () =>
    AccountSchema.parse({
      kind: 'nisa',
      common: baseCommon,
      brokerageName: { kind: 'sbi' },
      contribution: {
        currentAccumulated: 200000 as never,
        initialAccumulated: 0 as never,
        initialAccumulatedBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
    }) as NisaAccount

  it('証券会社名だけが変わり、積立累計は変更されない', () => {
    const updated = changeBrokerageName(nisa(), { kind: 'rakuten' }, 'user_honey' as never)
    expect(updated.brokerageName).toEqual({ kind: 'rakuten' })
    expect(updated.contribution).toEqual(nisa().contribution)
  })

  it('その他証券会社の空のカスタム名には変更できない', () => {
    expect(() =>
      changeBrokerageName(
        nisa(),
        { kind: 'other', customName: '' } as never,
        'user_honey' as never,
      ),
    ).toThrow()
  })

  it('所有者本人以外の操作は PermissionDeniedError', () => {
    expect(() => changeBrokerageName(nisa(), { kind: 'rakuten' }, 'user_darling' as never)).toThrow(
      PermissionDeniedError,
    )
  })
})

describe('asOtherSavingsAccount() / asNisaAccount()', () => {
  const smbc = () =>
    AccountSchema.parse({
      kind: 'smbc_bank',
      common: baseCommon,
      balance: {
        currentBalance: 0 as never,
        initialBalance: 0 as never,
        initialBalanceBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
    })

  it('種別が一致すればそのまま返す', () => {
    const otherSavings = registerOtherSavingsAccount({
      accountId: '01ACC000000000000000000002' as never,
      ownerUserId: 'user_honey' as never,
      bankName: '楽天銀行' as never,
      initialBalance: 0 as never,
      at: new Date('2026-07-01'),
    })
    expect(asOtherSavingsAccount(otherSavings)).toBe(otherSavings)
    const nisa = registerNisaAccount({
      accountId: '01ACC000000000000000000003' as never,
      ownerUserId: 'user_honey' as never,
      brokerageName: { kind: 'sbi' },
      initialAccumulated: 0 as never,
      at: new Date('2026-07-01'),
    })
    expect(asNisaAccount(nisa)).toBe(nisa)
  })

  it('種別不一致は InvariantViolationError', () => {
    expect(() => asOtherSavingsAccount(smbc())).toThrow(InvariantViolationError)
    expect(() => asNisaAccount(smbc())).toThrow(InvariantViolationError)
  })
})

// --- #65: SMBC 口座残高更新 ---

describe('applySmbcBalanceChange()', () => {
  const smbcAccount = () =>
    AccountSchema.parse({
      kind: 'smbc_bank',
      common: baseCommon,
      balance: {
        currentBalance: 100000 as never,
        initialBalance: 100000 as never,
        initialBalanceBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
    }) as SmbcBankAccount

  it('正の delta（入金）で残高を加算し、最終更新日時を進める', () => {
    const at = new Date('2026-04-25')
    const updated = applySmbcBalanceChange(smbcAccount(), 30000 as never, at)
    expect(updated.balance.currentBalance).toBe(130000)
    expect(updated.balance.lastUpdatedAt).toEqual(at)
  })

  it('負の delta（出金・引落消込変動）で残高を減算する', () => {
    const updated = applySmbcBalanceChange(smbcAccount(), -8000 as never, new Date('2026-05-26'))
    expect(updated.balance.currentBalance).toBe(92000)
  })

  it('初期残高・基準時刻は変更されない', () => {
    const updated = applySmbcBalanceChange(smbcAccount(), -8000 as never, new Date('2026-05-26'))
    expect(updated.balance.initialBalance).toBe(100000)
    expect(updated.balance.initialBalanceBaselineAt).toEqual(new Date('2026-04-01'))
  })

  it('非アクティブ口座への残高変動は InvariantViolationError（09-aggregates #9）', () => {
    const inactive = AccountSchema.parse({
      kind: 'smbc_bank',
      common: {
        ...baseCommon,
        activeness: {
          kind: 'inactive',
          inactivatedAt: new Date('2026-05-01'),
          reason: '解約済み',
        },
      },
      balance: {
        currentBalance: 100000 as never,
        initialBalance: 100000 as never,
        initialBalanceBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
    }) as SmbcBankAccount

    expect(() => applySmbcBalanceChange(inactive, 1000 as never, new Date('2026-05-26'))).toThrow(
      InvariantViolationError,
    )
  })
})

// --- #388: 引落消込の残高反映（同一通知の再反映を口座側で拒否する） ---

describe('applyUnpaidSettlementToSmbcBalance()', () => {
  const smbcAccount = () =>
    AccountSchema.parse({
      kind: 'smbc_bank',
      common: baseCommon,
      balance: {
        currentBalance: 100000 as never,
        initialBalance: 100000 as never,
        initialBalanceBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
    }) as SmbcBankAccount

  const NOTICE = 'notice_202605' as never
  const at = new Date('2026-05-26')

  it('この項目を持たない既存データは未反映（空）として読み出される', () => {
    expect(smbcAccount().balance.appliedSettlementNoticeIds).toEqual([])
  })

  it('消込合計だけ残高を減算し、反映元の引落確定通知IDを記録する', () => {
    const updated = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at,
    })

    expect(updated.balance.currentBalance).toBe(92000)
    expect(updated.balance.appliedSettlementNoticeIds).toEqual(['notice_202605'])
    expect(updated.balance.lastUpdatedAt).toEqual(at)
  })

  it('同一の引落確定通知で2回目の反映は UnpaidSettlementAlreadyAppliedError（冪等性）', () => {
    const once = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at,
    })

    expect(() =>
      applyUnpaidSettlementToSmbcBalance(once, {
        settlementNoticeId: NOTICE,
        settledTotal: 8000 as never,
        at: new Date('2026-05-27'),
      }),
    ).toThrow(UnpaidSettlementAlreadyAppliedError)
  })

  it('3回以上再実行しても残高は1回分しか減らない', () => {
    const once = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at,
    })

    // 呼び出し側（ハンドラー）が「反映済みなら現状維持」とする挙動を再現する
    let current = once
    for (let i = 0; i < 3; i++) {
      try {
        current = applyUnpaidSettlementToSmbcBalance(current, {
          settlementNoticeId: NOTICE,
          settledTotal: 8000 as never,
          at: new Date('2026-05-27'),
        })
      } catch (e) {
        if (!(e instanceof UnpaidSettlementAlreadyAppliedError)) throw e
      }
    }

    expect(current.balance.currentBalance).toBe(92000)
  })

  it('別の引落確定通知なら反映でき、記録が最新のものへ更新される', () => {
    const may = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at,
    })
    const june = applyUnpaidSettlementToSmbcBalance(may, {
      settlementNoticeId: 'notice_202606' as never,
      settledTotal: 2000 as never,
      at: new Date('2026-06-26'),
    })

    expect(june.balance.currentBalance).toBe(90000)
    expect(june.balance.appliedSettlementNoticeIds).toEqual(['notice_202605', 'notice_202606'])
  })

  it('別の通知を反映した後に古い通知を再実行しても、残高は減らない', () => {
    // 記録が「最後の1件」だけだとここを素通りし、5月分がもう一度減算される
    // （メール再取込で過去の通知が古い順に再発行される経路）
    const may = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at,
    })
    const june = applyUnpaidSettlementToSmbcBalance(may, {
      settlementNoticeId: 'notice_202606' as never,
      settledTotal: 2000 as never,
      at: new Date('2026-06-26'),
    })

    expect(() =>
      applyUnpaidSettlementToSmbcBalance(june, {
        settlementNoticeId: NOTICE,
        settledTotal: 8000 as never,
        at: new Date('2026-06-27'),
      }),
    ).toThrow(UnpaidSettlementAlreadyAppliedError)
  })

  it('通常の入出金反映（applySmbcBalanceChange）を挟んでも反映済みの記録は保たれる', () => {
    // 記録が落ちると同じ通知を再反映できてしまい、#388 が潰した二重減算が再発する
    const applied = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at,
    })
    const afterDeposit = applySmbcBalanceChange(applied, 30000 as never, new Date('2026-05-28'))

    expect(afterDeposit.balance.appliedSettlementNoticeIds).toEqual(['notice_202605'])
    expect(() =>
      applyUnpaidSettlementToSmbcBalance(afterDeposit, {
        settlementNoticeId: NOTICE,
        settledTotal: 8000 as never,
        at: new Date('2026-05-29'),
      }),
    ).toThrow(UnpaidSettlementAlreadyAppliedError)
  })

  it('消込合計が 0 円でも通知は反映済みとして記録される（以後この通知では減算しない）', () => {
    const applied = applyUnpaidSettlementToSmbcBalance(smbcAccount(), {
      settlementNoticeId: NOTICE,
      settledTotal: 0 as never,
      at,
    })

    expect(applied.balance.currentBalance).toBe(100000)
    expect(applied.balance.appliedSettlementNoticeIds).toEqual(['notice_202605'])
  })

  it('回復（遅れて古い通知を適用する）でも最終更新日時は巻き戻さない', () => {
    // この値は家計分析の残高鮮度評価に借用されるため、巻き戻すと残高が実際より古く見える
    const recent = applySmbcBalanceChange(
      smbcAccount(),
      30000 as never,
      new Date('2026-06-10T00:00:00Z'),
    )
    const recovered = applyUnpaidSettlementToSmbcBalance(recent, {
      settlementNoticeId: NOTICE,
      settledTotal: 8000 as never,
      at: new Date('2026-05-26T00:00:00Z'), // 6月の入金より古い5月の通知
    })

    expect(recovered.balance.currentBalance).toBe(122000)
    expect(recovered.balance.lastUpdatedAt).toEqual(new Date('2026-06-10T00:00:00Z'))
  })

  it('非アクティブ口座へは反映できない（applySmbcBalanceChange の不変条件を引き継ぐ）', () => {
    const inactive = AccountSchema.parse({
      kind: 'smbc_bank',
      common: {
        ...baseCommon,
        activeness: { kind: 'inactive', inactivatedAt: new Date('2026-05-01'), reason: '解約済み' },
      },
      balance: {
        currentBalance: 100000 as never,
        initialBalance: 100000 as never,
        initialBalanceBaselineAt: new Date('2026-04-01'),
        lastUpdatedAt: new Date('2026-04-01'),
      },
    }) as SmbcBankAccount

    expect(() =>
      applyUnpaidSettlementToSmbcBalance(inactive, {
        settlementNoticeId: NOTICE,
        settledTotal: 8000 as never,
        at,
      }),
    ).toThrow(InvariantViolationError)
  })
})

// --- #397: 残高の手動操作（取り崩し・手動補正・初期残高の後修正・非アクティブ化） ---

const OWNER = 'user_honey' as never
const SPOUSE = 'user_darling' as never
const AT = new Date('2026-07-20T00:00:00Z')

function otherSavings(
  overrides: { currentBalance?: number; initialBalance?: number; inactive?: boolean } = {},
): OtherSavingsAccount {
  return AccountSchema.parse({
    kind: 'other_savings',
    common: {
      ...baseCommon,
      activeness: overrides.inactive
        ? { kind: 'inactive', inactivatedAt: new Date('2026-05-01'), reason: '解約済み' }
        : { kind: 'active' },
    },
    bankName: '楽天銀行' as never,
    balance: {
      currentBalance: (overrides.currentBalance ?? 500000) as never,
      initialBalance: (overrides.initialBalance ?? 400000) as never,
      initialBalanceBaselineAt: new Date('2026-04-01'),
      lastUpdatedAt: new Date('2026-04-01'),
    },
    freshnessSource: { lastUpdatedAt: new Date('2026-04-01') },
  }) as OtherSavingsAccount
}

function nisa(
  overrides: {
    currentAccumulated?: number
    initialAccumulated?: number
    inactive?: boolean
  } = {},
): NisaAccount {
  return AccountSchema.parse({
    kind: 'nisa',
    common: {
      ...baseCommon,
      activeness: overrides.inactive
        ? { kind: 'inactive', inactivatedAt: new Date('2026-05-01'), reason: '解約済み' }
        : { kind: 'active' },
    },
    brokerageName: { kind: 'sbi' },
    contribution: {
      currentAccumulated: (overrides.currentAccumulated ?? 300000) as never,
      initialAccumulated: (overrides.initialAccumulated ?? 100000) as never,
      initialAccumulatedBaselineAt: new Date('2026-04-01'),
      lastUpdatedAt: new Date('2026-04-01'),
    },
  }) as NisaAccount
}

function smbcBank(
  overrides: { currentBalance?: number; initialBalance?: number } = {},
): SmbcBankAccount {
  return AccountSchema.parse({
    kind: 'smbc_bank',
    common: baseCommon,
    balance: {
      currentBalance: (overrides.currentBalance ?? 300000) as never,
      initialBalance: (overrides.initialBalance ?? 250000) as never,
      initialBalanceBaselineAt: new Date('2026-04-01'),
      lastUpdatedAt: new Date('2026-04-01'),
    },
  }) as SmbcBankAccount
}

function card(): Account {
  return AccountSchema.parse({
    kind: 'mitsui_sumitomo_card',
    common: baseCommon,
    unpaidAggregateRef: '01NP0000000000000000000001' as never,
  })
}

describe('addOtherSavingsBySmbcTransfer()', () => {
  it('振込額だけ残高を加算し、最終更新日時・鮮度根拠を進める', () => {
    const updated = addOtherSavingsBySmbcTransfer(otherSavings(), {
      amount: 50000 as never,
      at: AT,
    })
    expect(updated.balance.currentBalance).toBe(550000)
    expect(updated.balance.lastUpdatedAt).toEqual(AT)
    expect(updated.freshnessSource.lastUpdatedAt).toEqual(AT)
  })

  it('初期残高・基準時刻は変更されない', () => {
    const updated = addOtherSavingsBySmbcTransfer(otherSavings(), {
      amount: 50000 as never,
      at: AT,
    })
    expect(updated.balance.initialBalance).toBe(400000)
    expect(updated.balance.initialBalanceBaselineAt).toEqual(new Date('2026-04-01'))
  })

  it('0 円・負の金額は加算できない', () => {
    expect(() =>
      addOtherSavingsBySmbcTransfer(otherSavings(), { amount: 0 as never, at: AT }),
    ).toThrow(ZodError)
    expect(() =>
      addOtherSavingsBySmbcTransfer(otherSavings(), { amount: -1 as never, at: AT }),
    ).toThrow(ZodError)
  })

  it('非アクティブ口座へは加算できない（09-aggregates #9）', () => {
    expect(() =>
      addOtherSavingsBySmbcTransfer(otherSavings({ inactive: true }), {
        amount: 50000 as never,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
  })
})

describe('withdrawOtherSavings()', () => {
  it('取り崩し額だけ残高を減算し、鮮度根拠を進める', () => {
    const updated = withdrawOtherSavings(otherSavings(), {
      amount: 120000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.balance.currentBalance).toBe(380000)
    expect(updated.freshnessSource.lastUpdatedAt).toEqual(AT)
  })

  it('残高ちょうどまでは取り崩せる（境界値）', () => {
    const updated = withdrawOtherSavings(otherSavings({ currentBalance: 500000 }), {
      amount: 500000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.balance.currentBalance).toBe(0)
  })

  it('残高を 1 円でも超える取り崩しは InvariantViolationError（負残高にしない）', () => {
    expect(() =>
      withdrawOtherSavings(otherSavings({ currentBalance: 500000 }), {
        amount: 500001 as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
  })

  it('配偶者は取り崩しを記録できない（PermissionDeniedError）', () => {
    expect(() =>
      withdrawOtherSavings(otherSavings(), {
        amount: 1000 as never,
        operatorUserId: SPOUSE,
        at: AT,
      }),
    ).toThrow(PermissionDeniedError)
  })

  it('0 円・負の金額は取り崩せない', () => {
    expect(() =>
      withdrawOtherSavings(otherSavings(), { amount: 0 as never, operatorUserId: OWNER, at: AT }),
    ).toThrow(ZodError)
    expect(() =>
      withdrawOtherSavings(otherSavings(), { amount: -1 as never, operatorUserId: OWNER, at: AT }),
    ).toThrow(ZodError)
  })

  it('上限を超える金額は取り崩せない', () => {
    expect(() =>
      withdrawOtherSavings(otherSavings(), {
        amount: (BALANCE_INPUT_LIMIT + 1) as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(ZodError)
  })

  it('非アクティブ口座からは取り崩せない', () => {
    expect(() =>
      withdrawOtherSavings(otherSavings({ inactive: true }), {
        amount: 1000 as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
  })

  // --- #459: 手入力の操作記録 ---

  it('取り崩し手入力（入力者・金額・入力日時・メモ）を操作記録に 1 件積む', () => {
    const updated = withdrawOtherSavings(otherSavings(), {
      amount: 120000 as never,
      operatorUserId: OWNER,
      at: AT,
      memo: '旅行の頭金',
    })
    expect(updated.balance.manualEntries).toEqual([
      {
        kind: 'manual_withdrawal',
        enteredByUserId: OWNER,
        amount: 120000,
        enteredAt: AT,
        memo: '旅行の頭金',
      },
    ])
  })

  it('メモ無しの取り崩しはメモ項目を持たない', () => {
    const updated = withdrawOtherSavings(otherSavings(), {
      amount: 1000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.balance.manualEntries).toHaveLength(1)
    expect(updated.balance.manualEntries[0]).not.toHaveProperty('memo')
  })

  it('取り崩しを重ねると記録が古い順に積み上がる（追記のみ）', () => {
    const first = withdrawOtherSavings(otherSavings({ currentBalance: 500000 }), {
      amount: 100000 as never,
      operatorUserId: OWNER,
      at: new Date('2026-07-20T00:00:00Z'),
    })
    const second = withdrawOtherSavings(first, {
      amount: 50000 as never,
      operatorUserId: OWNER,
      at: new Date('2026-07-21T00:00:00Z'),
    })
    expect(
      second.balance.manualEntries.map(e => (e.kind === 'manual_withdrawal' ? e.amount : null)),
    ).toEqual([100000, 50000])
    expect(second.balance.currentBalance).toBe(350000)
  })

  it('拒否された取り崩し（残高超過）は記録に残らない', () => {
    // 元口座に記録が無いことを確かめてから、拒否が記録を増やさないことを見る
    const base = otherSavings({ currentBalance: 500000 })
    expect(base.balance.manualEntries).toEqual([])
    expect(() =>
      withdrawOtherSavings(base, { amount: 500001 as never, operatorUserId: OWNER, at: AT }),
    ).toThrow(InvariantViolationError)
    expect(base.balance.manualEntries).toEqual([])
  })

  it('空文字メモは受け付けない（未記入と区別できないため）', () => {
    expect(() =>
      withdrawOtherSavings(otherSavings(), {
        amount: 1000 as never,
        operatorUserId: OWNER,
        at: AT,
        memo: '',
      }),
    ).toThrow(ZodError)
  })

  it('空白のみメモは受け付けない（未記入と区別できないため）', () => {
    expect(() =>
      withdrawOtherSavings(otherSavings(), {
        amount: 1000 as never,
        operatorUserId: OWNER,
        at: AT,
        memo: '　  ',
      }),
    ).toThrow(ZodError)
  })

  it('メモは 200 文字まで受け付け、201 文字は拒否する（境界値）', () => {
    const at200 = withdrawOtherSavings(otherSavings(), {
      amount: 1000 as never,
      operatorUserId: OWNER,
      at: AT,
      memo: 'あ'.repeat(200),
    })
    expect(at200.balance.manualEntries[0]).toMatchObject({ memo: 'あ'.repeat(200) })
    expect(() =>
      withdrawOtherSavings(otherSavings(), {
        amount: 1000 as never,
        operatorUserId: OWNER,
        at: AT,
        memo: 'あ'.repeat(201),
      }),
    ).toThrow(ZodError)
  })
})

describe('correctOtherSavingsBalance()', () => {
  it('差分ではなく実際の残高へ差し替える', () => {
    const updated = correctOtherSavingsBalance(otherSavings({ currentBalance: 500000 }), {
      correctedBalance: 432100 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.balance.currentBalance).toBe(432100)
    expect(updated.balance.lastUpdatedAt).toEqual(AT)
    expect(updated.freshnessSource.lastUpdatedAt).toEqual(AT)
  })

  it('0 円への補正はできる（口座を使い切った状態、境界値）', () => {
    const updated = correctOtherSavingsBalance(otherSavings(), {
      correctedBalance: 0 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.balance.currentBalance).toBe(0)
  })

  it('負の残高へは補正できない（InvariantViolationError）', () => {
    expect(() =>
      correctOtherSavingsBalance(otherSavings(), {
        correctedBalance: -1 as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
  })

  it('上限を超える残高へは補正できない', () => {
    expect(() =>
      correctOtherSavingsBalance(otherSavings(), {
        correctedBalance: (BALANCE_INPUT_LIMIT + 1) as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(ZodError)
  })

  it('配偶者は補正できない（PermissionDeniedError）', () => {
    expect(() =>
      correctOtherSavingsBalance(otherSavings(), {
        correctedBalance: 1 as never,
        operatorUserId: SPOUSE,
        at: AT,
      }),
    ).toThrow(PermissionDeniedError)
  })

  it('非アクティブ口座は補正できない（09-aggregates #9）', () => {
    expect(() =>
      correctOtherSavingsBalance(otherSavings({ inactive: true }), {
        correctedBalance: 1 as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
  })

  // --- #459: 手入力の操作記録 ---

  it('残高補正手入力（入力者・補正前後の金額・入力日時・メモ）を操作記録に 1 件積む', () => {
    const updated = correctOtherSavingsBalance(otherSavings({ currentBalance: 500000 }), {
      correctedBalance: 432100 as never,
      operatorUserId: OWNER,
      at: AT,
      memo: '通帳と照合',
    })
    expect(updated.balance.manualEntries).toEqual([
      {
        kind: 'manual_correction',
        enteredByUserId: OWNER,
        balanceBefore: 500000,
        balanceAfter: 432100,
        enteredAt: AT,
        memo: '通帳と照合',
      },
    ])
  })

  it('補正前と同じ額での補正も記録する（確認したこと自体が鮮度の根拠）', () => {
    const updated = correctOtherSavingsBalance(otherSavings({ currentBalance: 500000 }), {
      correctedBalance: 500000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.balance.manualEntries).toHaveLength(1)
    expect(updated.balance.manualEntries[0]).toMatchObject({
      kind: 'manual_correction',
      balanceBefore: 500000,
      balanceAfter: 500000,
    })
  })

  it('拒否された補正（負残高）は記録に残らない', () => {
    const base = otherSavings({ currentBalance: 500000 })
    expect(() =>
      correctOtherSavingsBalance(base, {
        correctedBalance: -1 as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
    expect(base.balance.manualEntries).toEqual([])
  })
})

describe('addNisaContributionBySmbcTransfer()', () => {
  it('積立額だけ累計を加算し、最終更新日時を進める', () => {
    const updated = addNisaContributionBySmbcTransfer(nisa(), { amount: 33333 as never, at: AT })
    expect(updated.contribution.currentAccumulated).toBe(333333)
    expect(updated.contribution.lastUpdatedAt).toEqual(AT)
    expect(updated.contribution.initialAccumulated).toBe(100000)
  })

  it('0 円・負の金額は加算できない', () => {
    expect(() => addNisaContributionBySmbcTransfer(nisa(), { amount: 0 as never, at: AT })).toThrow(
      ZodError,
    )
    expect(() =>
      addNisaContributionBySmbcTransfer(nisa(), { amount: -1 as never, at: AT }),
    ).toThrow(ZodError)
  })

  it('上限を超える金額は加算できない', () => {
    expect(() =>
      addNisaContributionBySmbcTransfer(nisa(), {
        amount: (BALANCE_INPUT_LIMIT + 1) as never,
        at: AT,
      }),
    ).toThrow(ZodError)
  })

  it('非アクティブ口座へは加算できない（09-aggregates #9）', () => {
    expect(() =>
      addNisaContributionBySmbcTransfer(nisa({ inactive: true }), {
        amount: 1000 as never,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
  })
})

// --- #458: NISA 積立累計の手動補正 ---

describe('correctNisaContribution()', () => {
  it('差分ではなく実際の積立累計へ差し替える（二重加算を戻せる）', () => {
    const updated = correctNisaContribution(nisa({ currentAccumulated: 400000 }), {
      correctedAccumulated: 300000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.contribution.currentAccumulated).toBe(300000)
    expect(updated.contribution.lastUpdatedAt).toEqual(AT)
  })

  it('初期累計・初期累計基準時刻は動かさない（「始めた時点」の記録は補正の対象外）', () => {
    const base = nisa({ currentAccumulated: 400000, initialAccumulated: 100000 })
    const updated = correctNisaContribution(base, {
      correctedAccumulated: 250000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.contribution.initialAccumulated).toBe(100000)
    expect(updated.contribution.initialAccumulatedBaselineAt).toEqual(
      base.contribution.initialAccumulatedBaselineAt,
    )
  })

  it('0 円への補正はできる（積立を始めた記録ごと打ち消す、境界値）', () => {
    const updated = correctNisaContribution(nisa(), {
      correctedAccumulated: 0 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.contribution.currentAccumulated).toBe(0)
  })

  it('負の累計へは補正できない（InvariantViolationError）', () => {
    expect(() =>
      correctNisaContribution(nisa(), {
        correctedAccumulated: -1 as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
  })

  it('上限を超える累計へは補正できない', () => {
    expect(() =>
      correctNisaContribution(nisa(), {
        correctedAccumulated: (BALANCE_INPUT_LIMIT + 1) as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(ZodError)
  })

  it('上限ちょうどへは補正できる（境界値）', () => {
    const updated = correctNisaContribution(nisa(), {
      correctedAccumulated: BALANCE_INPUT_LIMIT as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.contribution.currentAccumulated).toBe(BALANCE_INPUT_LIMIT)
  })

  it('配偶者は補正できない（PermissionDeniedError）', () => {
    expect(() =>
      correctNisaContribution(nisa(), {
        correctedAccumulated: 1 as never,
        operatorUserId: SPOUSE,
        at: AT,
      }),
    ).toThrow(PermissionDeniedError)
  })

  it('非アクティブ口座は補正できない（09-aggregates #9）', () => {
    expect(() =>
      correctNisaContribution(nisa({ inactive: true }), {
        correctedAccumulated: 1 as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
  })

  it('積立累計補正手入力（入力者・補正前後の累計・入力日時・メモ）を操作記録に 1 件積む', () => {
    const updated = correctNisaContribution(nisa({ currentAccumulated: 400000 }), {
      correctedAccumulated: 300000 as never,
      operatorUserId: OWNER,
      at: AT,
      memo: '証券会社の画面と照合',
    })
    expect(updated.contribution.manualEntries).toEqual([
      {
        kind: 'manual_correction',
        enteredByUserId: OWNER,
        accumulatedBefore: 400000,
        accumulatedAfter: 300000,
        enteredAt: AT,
        memo: '証券会社の画面と照合',
      },
    ])
  })

  it('メモ未指定なら記録に memo を持たせない', () => {
    const updated = correctNisaContribution(nisa(), {
      correctedAccumulated: 300000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.contribution.manualEntries).toHaveLength(1)
    expect(updated.contribution.manualEntries[0]).not.toHaveProperty('memo')
  })

  it('空白のみのメモは受け付けない（書いていないことと区別が付かない）', () => {
    expect(() =>
      correctNisaContribution(nisa(), {
        correctedAccumulated: 300000 as never,
        operatorUserId: OWNER,
        at: AT,
        memo: '   ',
      }),
    ).toThrow(ZodError)
  })

  it('補正を重ねると記録が古い順に積み上がる（前の記録は書き換えない）', () => {
    const first = correctNisaContribution(nisa({ currentAccumulated: 400000 }), {
      correctedAccumulated: 300000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    const second = correctNisaContribution(first, {
      correctedAccumulated: 350000 as never,
      operatorUserId: OWNER,
      at: new Date('2026-07-21T00:00:00Z'),
    })
    expect(
      second.contribution.manualEntries.map(e => [e.accumulatedBefore, e.accumulatedAfter]),
    ).toEqual([
      [400000, 300000],
      [300000, 350000],
    ])
  })

  it('拒否された補正（負の累計）は記録に残らず、元の口座も変わらない', () => {
    const base = nisa({ currentAccumulated: 400000 })
    expect(() =>
      correctNisaContribution(base, {
        correctedAccumulated: -1 as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
    expect(base.contribution.manualEntries).toEqual([])
    expect(base.contribution.currentAccumulated).toBe(400000)
  })

  it('補正前と同じ額での補正も記録する（確認したこと自体が記録として意味を持つ）', () => {
    const updated = correctNisaContribution(nisa({ currentAccumulated: 300000 }), {
      correctedAccumulated: 300000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.contribution.manualEntries).toHaveLength(1)
  })
})

describe('correctInitialBalance()', () => {
  it('別銀行貯蓄: 初期残高の差分だけ現在残高もずれる（以降の変動は保たれる）', () => {
    // 初期 400000 + 以降の変動 +100000 = 現在 500000。初期を 450000 に直すと現在は 550000
    const { account: updated, oldInitialBalance } = correctInitialBalance(otherSavings(), {
      initialBalance: 450000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(oldInitialBalance).toBe(400000)
    if (updated.kind !== 'other_savings') throw new Error('unreachable')
    expect(updated.balance.initialBalance).toBe(450000)
    expect(updated.balance.currentBalance).toBe(550000)
    expect(updated.freshnessSource.lastUpdatedAt).toEqual(AT)
  })

  it('初期残高基準時刻は巻き直さない（いつ時点の残高かの記録、論点9）', () => {
    const { account: updated } = correctInitialBalance(otherSavings(), {
      initialBalance: 450000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    if (updated.kind !== 'other_savings') throw new Error('unreachable')
    expect(updated.balance.initialBalanceBaselineAt).toEqual(new Date('2026-04-01'))
  })

  it('NISA: 初期累計の差分だけ現在累計もずれる', () => {
    const { account: updated, oldInitialBalance } = correctInitialBalance(nisa(), {
      initialBalance: 80000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(oldInitialBalance).toBe(100000)
    if (updated.kind !== 'nisa') throw new Error('unreachable')
    expect(updated.contribution.initialAccumulated).toBe(80000)
    expect(updated.contribution.currentAccumulated).toBe(280000)
  })

  it('SMBC 銀行: 初期残高の差分だけ現在残高もずれる', () => {
    const { account: updated, oldInitialBalance } = correctInitialBalance(smbcBank(), {
      initialBalance: 200000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(oldInitialBalance).toBe(250000)
    if (updated.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(updated.balance.initialBalance).toBe(200000)
    expect(updated.balance.currentBalance).toBe(250000)
  })

  it('SMBC 銀行は現在残高が負になる修正も通す（通知由来の変動と同じ扱い）', () => {
    // 引落が入金より先に届けば一時的に負になりうるため、SMBC だけ非負を課さない。
    // 「一貫性のため」と非負チェックを足すとこのテストが落ちて意図に気づける
    const { account: updated } = correctInitialBalance(
      smbcBank({ currentBalance: 100000, initialBalance: 250000 }),
      { initialBalance: 0 as never, operatorUserId: OWNER, at: AT },
    )
    if (updated.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(updated.balance.currentBalance).toBe(-150000)
  })

  it('別銀行貯蓄: 修正で現在残高が負になる場合は InvariantViolationError', () => {
    // 現在 50000 / 初期 400000 → 初期を 0 にすると現在は -350000
    expect(() =>
      correctInitialBalance(otherSavings({ currentBalance: 50000, initialBalance: 400000 }), {
        initialBalance: 0 as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
  })

  it('別銀行貯蓄: 現在残高がちょうど 0 になる修正は通る（境界値）', () => {
    const { account: updated } = correctInitialBalance(
      otherSavings({ currentBalance: 50000, initialBalance: 400000 }),
      { initialBalance: 350000 as never, operatorUserId: OWNER, at: AT },
    )
    if (updated.kind !== 'other_savings') throw new Error('unreachable')
    expect(updated.balance.currentBalance).toBe(0)
  })

  it('NISA: 修正で積立累計が負になる場合は InvariantViolationError', () => {
    // 現在 50000 / 初期累計 100000 → 初期を 0 にすると現在は -50000
    expect(() =>
      correctInitialBalance(nisa({ currentAccumulated: 50000, initialAccumulated: 100000 }), {
        initialBalance: 0 as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
  })

  it('負の初期残高には修正できない', () => {
    expect(() =>
      correctInitialBalance(otherSavings(), {
        initialBalance: -1 as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
  })

  it('上限を超える初期残高には修正できない', () => {
    expect(() =>
      correctInitialBalance(otherSavings(), {
        initialBalance: (BALANCE_INPUT_LIMIT + 1) as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(ZodError)
  })

  it('配偶者は修正できない（PermissionDeniedError）', () => {
    expect(() =>
      correctInitialBalance(otherSavings(), {
        initialBalance: 1 as never,
        operatorUserId: SPOUSE,
        at: AT,
      }),
    ).toThrow(PermissionDeniedError)
  })

  it('三井住友カードは初期残高を持たないため修正できない', () => {
    expect(() =>
      correctInitialBalance(card(), { initialBalance: 0 as never, operatorUserId: OWNER, at: AT }),
    ).toThrow(InvariantViolationError)
  })

  it('非アクティブ口座は修正できない', () => {
    expect(() =>
      correctInitialBalance(otherSavings({ inactive: true }), {
        initialBalance: 1 as never,
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(InvariantViolationError)
  })
})

describe('inactivateAccount()', () => {
  it('非アクティブ状態・理由・日時が記録される', () => {
    const updated = inactivateAccount(otherSavings(), {
      reason: '解約したため',
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.common.activeness).toEqual({
      kind: 'inactive',
      inactivatedAt: AT,
      reason: '解約したため',
    })
  })

  it('NISA 口座も非アクティブ化できる', () => {
    const updated = inactivateAccount(nisa(), {
      reason: '口座を移管したため',
      operatorUserId: OWNER,
      at: AT,
    })
    expect(updated.common.activeness.kind).toBe('inactive')
  })

  it('残高はそのまま残る（過去の資産推移の根拠を消さない）', () => {
    const updated = inactivateAccount(otherSavings({ currentBalance: 500000 }), {
      reason: '解約したため',
      operatorUserId: OWNER,
      at: AT,
    })
    if (updated.kind !== 'other_savings') throw new Error('unreachable')
    expect(updated.balance.currentBalance).toBe(500000)
  })

  it('非アクティブ化後は残高変動を受け付けない', () => {
    const inactive = inactivateAccount(otherSavings(), {
      reason: '解約したため',
      operatorUserId: OWNER,
      at: AT,
    })
    if (inactive.kind !== 'other_savings') throw new Error('unreachable')
    expect(() =>
      withdrawOtherSavings(inactive, { amount: 1 as never, operatorUserId: OWNER, at: AT }),
    ).toThrow(InvariantViolationError)
  })

  it('配偶者は非アクティブ化できない（PermissionDeniedError）', () => {
    expect(() =>
      inactivateAccount(otherSavings(), {
        reason: '乗っ取り',
        operatorUserId: SPOUSE,
        at: AT,
      }),
    ).toThrow(PermissionDeniedError)
  })

  it('SMBC 銀行・三井住友カードは非アクティブ化できない（取込基盤が管理する口座）', () => {
    // 閉じると引落消込の残高反映が毎回落ち、消込済み・残高未反映から回復できなくなる
    expect(() =>
      inactivateAccount(smbcBank(), { reason: '解約', operatorUserId: OWNER, at: AT }),
    ).toThrow(InvariantViolationError)
    expect(() =>
      inactivateAccount(card(), { reason: '解約', operatorUserId: OWNER, at: AT }),
    ).toThrow(InvariantViolationError)
  })

  it('空の理由では非アクティブ化できない', () => {
    expect(() =>
      inactivateAccount(otherSavings(), { reason: '', operatorUserId: OWNER, at: AT }),
    ).toThrow(ZodError)
  })

  it('上限を超える長さの理由では非アクティブ化できない', () => {
    expect(() =>
      inactivateAccount(otherSavings(), {
        reason: 'あ'.repeat(101),
        operatorUserId: OWNER,
        at: AT,
      }),
    ).toThrow(ZodError)
  })

  it('既に非アクティブな口座の再実行は InvariantViolationError（最初に閉じた記録を上書きしない）', () => {
    const inactive = inactivateAccount(otherSavings(), {
      reason: '解約したため',
      operatorUserId: OWNER,
      at: AT,
    })
    expect(() =>
      inactivateAccount(inactive, {
        reason: '別の理由',
        operatorUserId: OWNER,
        at: new Date('2026-08-01'),
      }),
    ).toThrow(InvariantViolationError)
  })
})

describe('reactivateAccount()', () => {
  /** 非アクティブな三井住友系の口座（inactivateAccount では作れないため直接組み立てる） */
  function inactiveSmbcBank(): Account {
    return AccountSchema.parse({
      ...smbcBank(),
      common: {
        ...smbcBank().common,
        activeness: { kind: 'inactive', inactivatedAt: new Date('2026-05-01'), reason: '解約済み' },
      },
    })
  }

  it('アクティブに戻り、解除する非アクティブ記録（日時・理由）を返す', () => {
    const { account, clearedInactivation } = reactivateAccount(otherSavings({ inactive: true }), {
      operatorUserId: OWNER,
    })
    expect(account.common.activeness).toEqual({ kind: 'active' })
    expect(clearedInactivation).toEqual({
      inactivatedAt: new Date('2026-05-01'),
      reason: '解約済み',
    })
  })

  it('NISA 口座も戻せる', () => {
    const { account } = reactivateAccount(nisa({ inactive: true }), { operatorUserId: OWNER })
    expect(account.common.activeness.kind).toBe('active')
  })

  it('三井住友系の口座も戻せる（口座種別で絞らない — 閉じた口座を取り残さないため）', () => {
    // 非アクティブ化は別銀行貯蓄・NISA のみだが、戻す側を種別で拒むと、何らかの理由で
    // 非アクティブになった三井住友系の口座に復旧手段が無くなる
    const { account, clearedInactivation } = reactivateAccount(inactiveSmbcBank(), {
      operatorUserId: OWNER,
    })
    expect(account.common.activeness).toEqual({ kind: 'active' })
    expect(clearedInactivation.reason).toBe('解約済み')
  })

  it('戻した三井住友系の口座は残高変動を再び受け付ける', () => {
    const { account } = reactivateAccount(inactiveSmbcBank(), { operatorUserId: OWNER })
    if (account.kind !== 'smbc_bank') throw new Error('unreachable')
    expect(applySmbcBalanceChange(account, 1000 as never, AT).balance.currentBalance).toBe(301000)
  })

  it('戻した口座は残高変動を再び受け付ける（非アクティブ化を取り消せる）', () => {
    const inactive = inactivateAccount(otherSavings({ currentBalance: 500000 }), {
      reason: '解約したため',
      operatorUserId: OWNER,
      at: AT,
    })
    const { account } = reactivateAccount(inactive, { operatorUserId: OWNER })
    if (account.kind !== 'other_savings') throw new Error('unreachable')
    const withdrawn = withdrawOtherSavings(account, {
      amount: 100000 as never,
      operatorUserId: OWNER,
      at: AT,
    })
    expect(withdrawn.balance.currentBalance).toBe(400000)
  })

  it('残高・最終更新日時・鮮度根拠は閉じる前のまま（戻した時点を「最近確認した」ことにしない）', () => {
    const { account } = reactivateAccount(
      otherSavings({ inactive: true, currentBalance: 500000 }),
      {
        operatorUserId: OWNER,
      },
    )
    if (account.kind !== 'other_savings') throw new Error('unreachable')
    expect(account.balance.currentBalance).toBe(500000)
    expect(account.balance.lastUpdatedAt).toEqual(new Date('2026-04-01'))
    expect(account.freshnessSource.lastUpdatedAt).toEqual(new Date('2026-04-01'))
  })

  it('配偶者は戻せない（PermissionDeniedError）', () => {
    expect(() =>
      reactivateAccount(otherSavings({ inactive: true }), { operatorUserId: SPOUSE }),
    ).toThrow(PermissionDeniedError)
  })

  it('アクティブな口座への実行は InvariantViolationError', () => {
    expect(() => reactivateAccount(otherSavings(), { operatorUserId: OWNER })).toThrow(
      InvariantViolationError,
    )
  })

  it('版数は動かない（保存時の照合に使う「読み出したときの版」のまま）', () => {
    const base = otherSavings({ inactive: true })
    const inactive = AccountSchema.parse({ ...base, common: { ...base.common, version: 7 } })
    const { account } = reactivateAccount(inactive, { operatorUserId: OWNER })
    expect(account.common.version).toBe(7)
  })
})

describe('applyOtherSavingsBalanceChange()', () => {
  const registeredAt = new Date('2026-07-01T00:00:00Z')
  const at = new Date('2026-07-25T03:00:00Z')
  const register = () =>
    registerOtherSavingsAccount({
      accountId: '01ACC000000000000000000002' as never,
      ownerUserId: 'user_honey' as never,
      bankName: '楽天銀行' as never,
      initialBalance: 500000 as never,
      at: registeredAt,
    })

  it('SMBC からの振込（シャドウ残高加算）で現在残高が増える', () => {
    const updated = applyOtherSavingsBalanceChange(register(), 50000 as never, at)
    expect(updated.balance.currentBalance).toBe(550000)
  })

  it('別銀行戻し（負の delta）で現在残高が減る', () => {
    const updated = applyOtherSavingsBalanceChange(register(), -30000 as never, at)
    expect(updated.balance.currentBalance).toBe(470000)
  })

  it('残高鮮度の根拠も同じ時刻へ進む（更新済みなのに古いと表示されないようにする）', () => {
    const updated = applyOtherSavingsBalanceChange(register(), 50000 as never, at)
    expect(updated.balance.lastUpdatedAt).toEqual(at)
    expect(updated.freshnessSource.lastUpdatedAt).toEqual(at)
  })

  it('初期残高は書き換わらない（初期残高基準時刻も据え置き）', () => {
    const updated = applyOtherSavingsBalanceChange(register(), 50000 as never, at)
    expect(updated.balance.initialBalance).toBe(500000)
    expect(updated.balance.initialBalanceBaselineAt).toEqual(registeredAt)
  })

  it('非アクティブ口座へは適用できない', () => {
    const inactive = AccountSchema.parse({
      ...register(),
      common: {
        ...register().common,
        activeness: { kind: 'inactive', inactivatedAt: new Date('2026-07-10'), reason: '解約済み' },
      },
    }) as OtherSavingsAccount

    expect(() => applyOtherSavingsBalanceChange(inactive, 50000 as never, at)).toThrow(
      InvariantViolationError,
    )
  })
})

describe('applyOtherSavingsMovement()', () => {
  const registeredAt = new Date('2026-07-01T00:00:00Z')
  const at = new Date('2026-07-25T03:00:00Z')
  const TX_A = '01TXN000000000000000000001' as never
  const TX_B = '01TXN000000000000000000002' as never
  const register = () =>
    registerOtherSavingsAccount({
      accountId: '01ACC000000000000000000002' as never,
      ownerUserId: 'user_honey' as never,
      bankName: '楽天銀行' as never,
      initialBalance: 500000 as never,
      at: registeredAt,
    })

  it('取引由来の加算が反映され、適用元の取引IDが記録される', () => {
    const updated = applyOtherSavingsMovement(register(), {
      transactionId: TX_A,
      delta: 50000 as never,
      at,
    })
    expect(updated.balance.currentBalance).toBe(550000)
    expect(updated.balance.appliedMovementTransactionIds).toEqual([TX_A])
  })

  it('同一取引の二度目は OtherSavingsMovementAlreadyAppliedError（残高が二重に動かない）', () => {
    const once = applyOtherSavingsMovement(register(), {
      transactionId: TX_A,
      delta: -30000 as never,
      at,
    })
    expect(() =>
      applyOtherSavingsMovement(once, { transactionId: TX_A, delta: -30000 as never, at }),
    ).toThrow(OtherSavingsMovementAlreadyAppliedError)
    expect(once.balance.currentBalance).toBe(470000)
  })

  it('別の取引は続けて反映でき、適用元が積み上がる', () => {
    const first = applyOtherSavingsMovement(register(), {
      transactionId: TX_A,
      delta: 50000 as never,
      at,
    })
    const second = applyOtherSavingsMovement(first, {
      transactionId: TX_B,
      delta: -20000 as never,
      at,
    })
    expect(second.balance.currentBalance).toBe(530000)
    expect(second.balance.appliedMovementTransactionIds).toEqual([TX_A, TX_B])
  })

  it('先に適用した取引が後から再送されても拒否される（集合で持つため）', () => {
    const first = applyOtherSavingsMovement(register(), {
      transactionId: TX_A,
      delta: 50000 as never,
      at,
    })
    const second = applyOtherSavingsMovement(first, {
      transactionId: TX_B,
      delta: -20000 as never,
      at,
    })
    expect(() =>
      applyOtherSavingsMovement(second, { transactionId: TX_A, delta: 50000 as never, at }),
    ).toThrow(OtherSavingsMovementAlreadyAppliedError)
  })

  it('遅れて古い移動を適用しても最終更新日時は巻き戻らない（回復時に残高が古く見えない）', () => {
    const recent = applyOtherSavingsMovement(register(), {
      transactionId: TX_A,
      delta: 50000 as never,
      at,
    })
    const late = applyOtherSavingsMovement(recent, {
      transactionId: TX_B,
      delta: 10000 as never,
      at: new Date('2026-07-10T00:00:00Z'),
    })
    expect(late.balance.currentBalance).toBe(560000)
    expect(late.balance.lastUpdatedAt).toEqual(at)
    expect(late.freshnessSource.lastUpdatedAt).toEqual(at)
  })

  it('残高を超える戻しでシャドウ残高は負になる（取込ラグで一時的に起こりうる）', () => {
    const small = registerOtherSavingsAccount({
      accountId: '01ACC000000000000000000003' as never,
      ownerUserId: 'user_honey' as never,
      bankName: '楽天銀行' as never,
      initialBalance: 100000 as never,
      at: registeredAt,
    })
    const updated = applyOtherSavingsMovement(small, {
      transactionId: TX_A,
      delta: -300000 as never,
      at,
    })
    expect(updated.balance.currentBalance).toBe(-200000)
  })

  it('非アクティブ口座へは適用できない', () => {
    const inactive = AccountSchema.parse({
      ...register(),
      common: {
        ...register().common,
        activeness: { kind: 'inactive', inactivatedAt: new Date('2026-07-10'), reason: '解約済み' },
      },
    }) as OtherSavingsAccount

    expect(() =>
      applyOtherSavingsMovement(inactive, { transactionId: TX_A, delta: 50000 as never, at }),
    ).toThrow(InvariantViolationError)
  })

  it('既存データ（適用元の記録を持たない payload）は空配列として読み出される', () => {
    const legacy = AccountSchema.parse({
      kind: 'other_savings',
      common: register().common,
      bankName: '楽天銀行',
      balance: {
        currentBalance: 500000,
        initialBalance: 500000,
        initialBalanceBaselineAt: registeredAt,
        lastUpdatedAt: registeredAt,
      },
      freshnessSource: { lastUpdatedAt: registeredAt },
    }) as OtherSavingsAccount
    expect(legacy.balance.appliedMovementTransactionIds).toEqual([])
  })
})
