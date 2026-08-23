import { describe, it, expect } from 'vitest'
import {
  BalanceHistoryEntrySchema,
  balanceHistoryOfAxis,
  latestBalanceOfAxis,
  recordBalanceChange,
  type BalanceHistoryEntry,
} from '../../../src/balance-asset-tracking/aggregates/BalanceHistoryEntry'
import {
  balanceAxisOfAccountKind,
  type BalanceAxis,
} from '../../../src/balance-asset-tracking/value-objects/BalanceAxis'
import { AccountIdSchema, BalanceHistoryEntryIdSchema } from '../../../src/shared/ids'
import type { AccountId } from '../../../src/shared/ids'
import { money } from '../../../src/shared/value-objects/Money'
import { testUlid } from '../../helpers/ids'

const ACCOUNT_ID: AccountId = AccountIdSchema.parse(testUlid('01ACC'))

/** 履歴エントリIDは同時刻の並び順を決めるため、既定は採番順で単調増加させる */
let counter = 1

function entry(input: {
  axis?: BalanceAxis
  balance?: number
  occurredAt?: Date
  sourceEventId?: string
  entryId?: string
}): BalanceHistoryEntry {
  return recordBalanceChange({
    entryId: BalanceHistoryEntryIdSchema.parse(input.entryId ?? testUlid('01BHE', counter++)),
    axis: input.axis ?? 'smbc_balance',
    accountId: ACCOUNT_ID,
    balance: money(input.balance ?? 1000),
    occurredAt: input.occurredAt ?? new Date('2026-05-10T00:00:00.000Z'),
    sourceEventId: input.sourceEventId ?? 'evt-1',
  })
}

describe('残高変動履歴エントリ（#398）', () => {
  it('変動後の値・発生日時・由来イベントIDを備えたエントリを作る', () => {
    const recorded = entry({ balance: 1500000, occurredAt: new Date('2026-05-10T01:00:00.000Z') })
    expect(recorded).toMatchObject({
      axis: 'smbc_balance',
      accountId: ACCOUNT_ID,
      balance: 1500000,
      sourceEventId: 'evt-1',
    })
    expect(recorded.occurredAt).toEqual(new Date('2026-05-10T01:00:00.000Z'))
  })

  it('由来イベントIDが空文字のエントリは作れない（冪等キーが機能しなくなる）', () => {
    expect(() => entry({ sourceEventId: '' })).toThrow()
  })

  it('未知の残高軸は受け付けない', () => {
    expect(() =>
      BalanceHistoryEntrySchema.parse({
        entryId: testUlid('01BHE', 9),
        axis: 'crypto',
        accountId: ACCOUNT_ID,
        balance: 1,
        occurredAt: new Date(),
        sourceEventId: 'evt-1',
      }),
    ).toThrow()
  })

  it('残高は負でも記録できる（SMBC 残高は引落が入金より先に届くと一時的に負になりうる）', () => {
    expect(entry({ balance: -5000 }).balance).toBe(-5000)
  })

  describe('balanceAxisOfAccountKind', () => {
    it('口座種別ごとに対応する軸を返す（カードは未払い合計の軸）', () => {
      expect(balanceAxisOfAccountKind('smbc_bank')).toBe('smbc_balance')
      expect(balanceAxisOfAccountKind('other_savings')).toBe('other_savings_balance')
      expect(balanceAxisOfAccountKind('nisa')).toBe('nisa_contribution')
      expect(balanceAxisOfAccountKind('mitsui_sumitomo_card')).toBe('card_unpaid')
    })
  })

  describe('balanceHistoryOfAxis', () => {
    it('指定軸だけを発生日時の昇順で返す（他の軸は混ざらない）', () => {
      const entries = [
        entry({ balance: 300, occurredAt: new Date('2026-05-30T00:00:00.000Z') }),
        entry({ axis: 'card_unpaid', balance: 42000 }),
        entry({ balance: 100, occurredAt: new Date('2026-05-01T00:00:00.000Z') }),
        entry({ balance: 200, occurredAt: new Date('2026-05-15T00:00:00.000Z') }),
      ]
      expect(balanceHistoryOfAxis(entries, 'smbc_balance').map(e => e.balance)).toEqual([
        100, 200, 300,
      ])
    })

    it('同時刻の変動は記録順（履歴エントリIDの昇順）で並ぶ', () => {
      const at = new Date('2026-05-10T00:00:00.000Z')
      const entries = [
        entry({ entryId: testUlid('01BHE', 'B'), balance: 2, occurredAt: at }),
        entry({ entryId: testUlid('01BHE', 'A'), balance: 1, occurredAt: at }),
      ]
      expect(balanceHistoryOfAxis(entries, 'smbc_balance').map(e => e.balance)).toEqual([1, 2])
    })

    it('入力の配列は書き換えない', () => {
      const entries = [
        entry({ balance: 300, occurredAt: new Date('2026-05-30T00:00:00.000Z') }),
        entry({ balance: 100, occurredAt: new Date('2026-05-01T00:00:00.000Z') }),
      ]
      balanceHistoryOfAxis(entries, 'smbc_balance')
      expect(entries.map(e => e.balance)).toEqual([300, 100])
    })
  })

  describe('latestBalanceOfAxis', () => {
    it('その軸の最後の値を返す', () => {
      const entries = [
        entry({ axis: 'nisa_contribution', balance: 300000, occurredAt: new Date('2026-05-01') }),
        entry({ axis: 'nisa_contribution', balance: 400000, occurredAt: new Date('2026-05-20') }),
      ]
      expect(latestBalanceOfAxis(entries, 'nisa_contribution')).toBe(400000)
    })

    it('その軸の点が無ければ null（0 で埋めない — 残高 0 円と区別がつかなくなる）', () => {
      expect(latestBalanceOfAxis([entry({ axis: 'smbc_balance' })], 'card_unpaid')).toBeNull()
    })
  })
})
