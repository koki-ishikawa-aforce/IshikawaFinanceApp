import { describe, it, expect } from 'vitest'
import { AccountSchema } from '../../../src/balance-asset-tracking/aggregates/Account'

const baseCommon = {
  accountId: 'acc_001' as never,
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
        unpaidAggregateRef: 'unp_001' as never,
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
