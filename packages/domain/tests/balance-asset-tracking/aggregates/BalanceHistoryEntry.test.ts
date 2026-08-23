import { describe, it, expect } from 'vitest'
import {
  BalanceHistoryEntrySchema,
  balanceHistoryOfAxis,
  householdBalanceSeriesOfAxis,
  latestHouseholdValueOfAxis,
  recordBalanceChange,
  type BalanceHistoryEntry,
} from '../../../src/balance-asset-tracking/aggregates/BalanceHistoryEntry'
import { type BalanceAxis } from '../../../src/balance-asset-tracking/value-objects/BalanceAxis'
import { AccountIdSchema, BalanceHistoryEntryIdSchema } from '../../../src/shared/ids'
import type { AccountId } from '../../../src/shared/ids'
import { money } from '../../../src/shared/value-objects/Money'
import { testUlid } from '../../helpers/ids'

const ACCOUNT_ID: AccountId = AccountIdSchema.parse(testUlid('01ACC'))
const SPOUSE_ACCOUNT_ID: AccountId = AccountIdSchema.parse(testUlid('01ACD'))

/** 履歴エントリIDは同時刻の並び順を決めるため、既定は採番順で単調増加させる */
let counter = 1

function entry(input: {
  axis?: BalanceAxis
  accountId?: AccountId
  value?: number
  occurredAt?: Date
  sourceEventId?: string
  entryId?: string
}): BalanceHistoryEntry {
  return recordBalanceChange({
    entryId: BalanceHistoryEntryIdSchema.parse(input.entryId ?? testUlid('01BHE', counter++)),
    axis: input.axis ?? 'smbc_balance',
    accountId: input.accountId ?? ACCOUNT_ID,
    value: money(input.value ?? 1000),
    occurredAt: input.occurredAt ?? new Date('2026-05-10T00:00:00.000Z'),
    sourceEventId: input.sourceEventId ?? `evt-${counter}`,
  })
}

describe('残高変動履歴エントリ（#398）', () => {
  it('変動後の値・発生日時・由来イベントIDを備えたエントリを作る', () => {
    const recorded = entry({
      value: 1500000,
      occurredAt: new Date('2026-05-10T01:00:00.000Z'),
      sourceEventId: 'evt-1',
    })
    expect(recorded).toMatchObject({
      axis: 'smbc_balance',
      accountId: ACCOUNT_ID,
      value: 1500000,
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
        value: 1,
        occurredAt: new Date(),
        sourceEventId: 'evt-1',
      }),
    ).toThrow()
  })

  it('変動後の値は負でも記録できる（SMBC 残高は引落が入金より先に届くと一時的に負になりうる）', () => {
    expect(entry({ value: -5000 }).value).toBe(-5000)
  })

  describe('balanceHistoryOfAxis', () => {
    it('指定軸だけを発生日時の昇順で返す（他の軸は混ざらない）', () => {
      const entries = [
        entry({ value: 300, occurredAt: new Date('2026-05-30T00:00:00.000Z') }),
        entry({ axis: 'card_unpaid', value: 42000 }),
        entry({ value: 100, occurredAt: new Date('2026-05-01T00:00:00.000Z') }),
        entry({ value: 200, occurredAt: new Date('2026-05-15T00:00:00.000Z') }),
      ]
      expect(balanceHistoryOfAxis(entries, 'smbc_balance').map(e => e.value)).toEqual([
        100, 200, 300,
      ])
    })

    it('同時刻の変動は記録順（履歴エントリIDの昇順）で並ぶ', () => {
      const at = new Date('2026-05-10T00:00:00.000Z')
      const entries = [
        entry({ entryId: testUlid('01BHE', 'B'), value: 2, occurredAt: at }),
        entry({ entryId: testUlid('01BHE', 'A'), value: 1, occurredAt: at }),
      ]
      expect(balanceHistoryOfAxis(entries, 'smbc_balance').map(e => e.value)).toEqual([1, 2])
    })

    it('入力の配列は書き換えない', () => {
      const entries = [
        entry({ value: 300, occurredAt: new Date('2026-05-30T00:00:00.000Z') }),
        entry({ value: 100, occurredAt: new Date('2026-05-01T00:00:00.000Z') }),
      ]
      balanceHistoryOfAxis(entries, 'smbc_balance')
      expect(entries.map(e => e.value)).toEqual([300, 100])
    })
  })

  describe('householdBalanceSeriesOfAxis', () => {
    it('口座が 1 つなら、その口座の値がそのまま世帯の値になる', () => {
      const entries = [
        entry({ value: 100, occurredAt: new Date('2026-05-01T00:00:00.000Z') }),
        entry({ value: 200, occurredAt: new Date('2026-05-10T00:00:00.000Z') }),
      ]
      expect(householdBalanceSeriesOfAxis(entries, 'smbc_balance').map(p => p.value)).toEqual([
        100, 200,
      ])
    })

    it('同じ軸に 2 口座（夫婦それぞれの貯蓄口座）があると、直近値を持ち越して合算する', () => {
      // 口座別の点をそのまま並べると線が 2 人の残高を行き来してしまう
      const entries = [
        entry({
          axis: 'other_savings_balance',
          accountId: ACCOUNT_ID,
          value: 800000,
          occurredAt: new Date('2026-05-01T00:00:00.000Z'),
        }),
        entry({
          axis: 'other_savings_balance',
          accountId: SPOUSE_ACCOUNT_ID,
          value: 200000,
          occurredAt: new Date('2026-05-10T00:00:00.000Z'),
        }),
        entry({
          axis: 'other_savings_balance',
          accountId: ACCOUNT_ID,
          value: 750000,
          occurredAt: new Date('2026-05-20T00:00:00.000Z'),
        }),
      ]
      expect(
        householdBalanceSeriesOfAxis(entries, 'other_savings_balance').map(p => p.value),
      ).toEqual([800000, 1000000, 950000])
    })

    it('期間より前に動いた口座の残高も合計に入る（opening を持ち越す）', () => {
      const opening = [
        entry({
          axis: 'other_savings_balance',
          accountId: SPOUSE_ACCOUNT_ID,
          value: 200000,
          occurredAt: new Date('2026-04-20T00:00:00.000Z'),
        }),
      ]
      const entries = [
        entry({
          axis: 'other_savings_balance',
          accountId: ACCOUNT_ID,
          value: 800000,
          occurredAt: new Date('2026-05-01T00:00:00.000Z'),
        }),
      ]
      const series = householdBalanceSeriesOfAxis(entries, 'other_savings_balance', opening)
      // opening 自体は点にしない（期間外の日時に点を打たない）
      expect(series).toHaveLength(1)
      expect(series[0]?.value).toBe(1000000)
      expect(series[0]?.occurredAt).toEqual(new Date('2026-05-01T00:00:00.000Z'))
    })

    it('他の軸の opening は混ざらない', () => {
      const opening = [entry({ axis: 'smbc_balance', value: 999 })]
      const entries = [
        entry({
          axis: 'other_savings_balance',
          value: 100,
          occurredAt: new Date('2026-05-05T00:00:00.000Z'),
        }),
      ]
      expect(
        householdBalanceSeriesOfAxis(entries, 'other_savings_balance', opening).map(p => p.value),
      ).toEqual([100])
    })

    it('その軸に点が無ければ空（opening があっても点は作らない）', () => {
      const opening = [entry({ axis: 'nisa_contribution', value: 300000 })]
      expect(householdBalanceSeriesOfAxis([], 'nisa_contribution', opening)).toEqual([])
    })
  })

  describe('latestHouseholdValueOfAxis', () => {
    it('期間内の最後の世帯合算値を返す', () => {
      const entries = [
        entry({
          axis: 'nisa_contribution',
          value: 300000,
          occurredAt: new Date('2026-05-01T00:00:00.000Z'),
        }),
        entry({
          axis: 'nisa_contribution',
          accountId: SPOUSE_ACCOUNT_ID,
          value: 100000,
          occurredAt: new Date('2026-05-20T00:00:00.000Z'),
        }),
      ]
      expect(latestHouseholdValueOfAxis(entries, 'nisa_contribution')).toBe(400000)
    })

    it('期間内に点が無ければ opening の合計を引き継ぐ（当月に積立が無くても累計は残る）', () => {
      const opening = [
        entry({ axis: 'nisa_contribution', accountId: ACCOUNT_ID, value: 300000 }),
        entry({ axis: 'nisa_contribution', accountId: SPOUSE_ACCOUNT_ID, value: 100000 }),
      ]
      expect(latestHouseholdValueOfAxis([], 'nisa_contribution', opening)).toBe(400000)
    })

    it('記録が一度も無ければ null（0 で埋めない — 積立ゼロと区別がつかなくなる）', () => {
      expect(latestHouseholdValueOfAxis([], 'nisa_contribution')).toBeNull()
      expect(
        latestHouseholdValueOfAxis([entry({ axis: 'smbc_balance' })], 'card_unpaid'),
      ).toBeNull()
    })
  })
})
