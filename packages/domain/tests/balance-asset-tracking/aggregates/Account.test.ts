import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import {
  AccountSchema,
  BALANCE_INPUT_LIMIT,
  addNisaContributionBySmbcTransfer,
  addOtherSavingsBySmbcTransfer,
  applySmbcBalanceChange,
  applyUnpaidSettlementToSmbcBalance,
  asNisaAccount,
  asOtherSavingsAccount,
  changeBankName,
  changeBrokerageName,
  correctInitialBalance,
  correctOtherSavingsBalance,
  inactivateAccount,
  registerNisaAccount,
  registerOtherSavingsAccount,
  withdrawOtherSavings,
  type Account,
  type NisaAccount,
  type OtherSavingsAccount,
  type SmbcBankAccount,
} from '../../../src/balance-asset-tracking/aggregates/Account'
import {
  InvariantViolationError,
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
