import { describe, it, expect } from 'vitest'
import {
  AccountSchema,
  applySmbcBalanceChange,
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
