import { describe, it, expect } from 'vitest'
import {
  AccountSchema,
  applySmbcBalanceChange,
  changeBankName,
  changeBrokerageName,
  registerNisaAccount,
  registerOtherSavingsAccount,
  type NisaAccount,
  type OtherSavingsAccount,
  type SmbcBankAccount,
} from '../../../src/balance-asset-tracking/aggregates/Account'
import { InvariantViolationError } from '../../../src/shared/errors/DomainError'

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
    const updated = changeBankName(otherSavings(), '住信SBIネット銀行' as never)
    expect(updated.bankName).toBe('住信SBIネット銀行')
    expect(updated.balance).toEqual(otherSavings().balance)
    expect(updated.freshnessSource).toEqual(otherSavings().freshnessSource)
    expect(updated.common).toEqual(otherSavings().common)
  })

  it('空の銀行名には変更できない（BankName の不変条件）', () => {
    expect(() => changeBankName(otherSavings(), '' as never)).toThrow()
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
    const updated = changeBrokerageName(nisa(), { kind: 'rakuten' })
    expect(updated.brokerageName).toEqual({ kind: 'rakuten' })
    expect(updated.contribution).toEqual(nisa().contribution)
  })

  it('その他証券会社の空のカスタム名には変更できない', () => {
    expect(() => changeBrokerageName(nisa(), { kind: 'other', customName: '' } as never)).toThrow()
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
