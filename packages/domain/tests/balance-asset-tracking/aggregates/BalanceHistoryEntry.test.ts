import { describe, it, expect } from 'vitest'
import {
  BalanceHistoryEntrySchema,
  accountBalanceHistoryRows,
  accountBalanceSeriesOfAxis,
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

describe('口座 1 件の推移（#406）', () => {
  const WINDOW_START = new Date('2026-05-01T00:00:00.000Z')

  it('期間内の変動をそのまま点にする（世帯合算と違い、直近値の持ち越し合計をしない）', () => {
    const series = accountBalanceSeriesOfAxis({
      entries: [
        entry({ value: 1000, occurredAt: new Date('2026-05-10T00:00:00.000Z') }),
        entry({ value: 1200, occurredAt: new Date('2026-05-20T00:00:00.000Z') }),
      ],
      accountId: ACCOUNT_ID,
      axis: 'smbc_balance',
      opening: null,
      windowStart: WINDOW_START,
    })
    expect(series).toEqual([
      { occurredAt: new Date('2026-05-10T00:00:00.000Z'), value: 1000 },
      { occurredAt: new Date('2026-05-20T00:00:00.000Z'), value: 1200 },
    ])
  })

  it('期間より前の最後の値を期間の起点に置く（期間中に動きが無くても線が出る）', () => {
    const opening = entry({ value: 900, occurredAt: new Date('2026-03-01T00:00:00.000Z') })
    const series = accountBalanceSeriesOfAxis({
      entries: [],
      accountId: ACCOUNT_ID,
      axis: 'smbc_balance',
      opening,
      windowStart: WINDOW_START,
    })
    expect(series).toEqual([{ occurredAt: WINDOW_START, value: 900 }])
  })

  it('起点と期間内の点が両方あれば、起点を先頭に置いてから発生日時の順に並べる', () => {
    const series = accountBalanceSeriesOfAxis({
      entries: [entry({ value: 1000, occurredAt: new Date('2026-05-10T00:00:00.000Z') })],
      accountId: ACCOUNT_ID,
      axis: 'smbc_balance',
      opening: entry({ value: 900, occurredAt: new Date('2026-03-01T00:00:00.000Z') }),
      windowStart: WINDOW_START,
    })
    expect(series).toEqual([
      { occurredAt: WINDOW_START, value: 900 },
      { occurredAt: new Date('2026-05-10T00:00:00.000Z'), value: 1000 },
    ])
  })

  it('期間の開始ちょうどに記録があれば起点を置かない（同じ時刻に点が 2 つ並ばない）', () => {
    const series = accountBalanceSeriesOfAxis({
      entries: [entry({ value: 1000, occurredAt: WINDOW_START })],
      accountId: ACCOUNT_ID,
      axis: 'smbc_balance',
      opening: entry({ value: 900, occurredAt: new Date('2026-03-01T00:00:00.000Z') }),
      windowStart: WINDOW_START,
    })
    expect(series).toEqual([{ occurredAt: WINDOW_START, value: 1000 }])
  })

  it('起点の軸が違えば持ち越さない', () => {
    const series = accountBalanceSeriesOfAxis({
      entries: [],
      accountId: ACCOUNT_ID,
      axis: 'smbc_balance',
      opening: entry({ axis: 'nisa_contribution', value: 900 }),
      windowStart: WINDOW_START,
    })
    expect(series).toEqual([])
  })

  it('別の口座のエントリは点にも起点にもしない（線が他人の残高を行き来しない）', () => {
    const series = accountBalanceSeriesOfAxis({
      entries: [
        entry({ value: 1000, occurredAt: new Date('2026-05-10T00:00:00.000Z') }),
        entry({
          accountId: SPOUSE_ACCOUNT_ID,
          value: 5000,
          occurredAt: new Date('2026-05-15T00:00:00.000Z'),
        }),
      ],
      accountId: ACCOUNT_ID,
      axis: 'smbc_balance',
      opening: entry({ accountId: SPOUSE_ACCOUNT_ID, value: 4000 }),
      windowStart: WINDOW_START,
    })
    expect(series).toEqual([{ occurredAt: new Date('2026-05-10T00:00:00.000Z'), value: 1000 }])
  })
})

describe('口座 1 件の残高変動履歴（#406）', () => {
  it('直前の値からの増減を出し、起点が無い最初の行だけ増減を空にする', () => {
    const rows = accountBalanceHistoryRows({
      entries: [
        entry({ value: 1000, occurredAt: new Date('2026-05-10T00:00:00.000Z') }),
        entry({ value: 1200, occurredAt: new Date('2026-05-20T00:00:00.000Z') }),
        entry({ value: 800, occurredAt: new Date('2026-05-25T00:00:00.000Z') }),
      ],
      accountId: ACCOUNT_ID,
      axis: 'smbc_balance',
      opening: null,
      manualEntries: [],
    })
    expect(rows.map(r => r.delta)).toEqual([null, 200, -400])
    expect(rows.map(r => r.valueAfter)).toEqual([1000, 1200, 800])
  })

  it('値が動かなかった行の増減は 0 で、起点が無い行（null）と区別できる', () => {
    const rows = accountBalanceHistoryRows({
      entries: [
        entry({ value: 1000, occurredAt: new Date('2026-05-10T00:00:00.000Z') }),
        entry({ value: 1000, occurredAt: new Date('2026-05-20T00:00:00.000Z') }),
      ],
      accountId: ACCOUNT_ID,
      axis: 'smbc_balance',
      opening: null,
      manualEntries: [],
    })
    expect(rows.map(r => r.delta)).toEqual([null, 0])
  })

  it('期間より前の値がある行は、そこからの増減を出す', () => {
    const rows = accountBalanceHistoryRows({
      entries: [entry({ value: 1000, occurredAt: new Date('2026-05-10T00:00:00.000Z') })],
      accountId: ACCOUNT_ID,
      axis: 'smbc_balance',
      opening: entry({ value: 700, occurredAt: new Date('2026-03-01T00:00:00.000Z') }),
      manualEntries: [],
    })
    expect(rows[0]?.delta).toBe(300)
  })

  it('発生日時が一致する手入力記録の種別とメモを添える', () => {
    const enteredAt = new Date('2026-05-20T00:00:00.000Z')
    const rows = accountBalanceHistoryRows({
      entries: [
        entry({ value: 1000, occurredAt: new Date('2026-05-10T00:00:00.000Z') }),
        entry({ value: 800, occurredAt: enteredAt }),
      ],
      accountId: ACCOUNT_ID,
      axis: 'smbc_balance',
      opening: null,
      manualEntries: [{ kind: 'manual_withdrawal', enteredAt, memo: '旅行費' }],
    })
    expect(rows.map(r => r.source)).toEqual(['auto', 'manual_withdrawal'])
    expect(rows.map(r => r.memo)).toEqual([undefined, '旅行費'])
  })

  it('発生日時が一致しない手入力記録は添えない（金額と件数は履歴の側が正）', () => {
    const rows = accountBalanceHistoryRows({
      entries: [entry({ value: 800, occurredAt: new Date('2026-05-20T00:00:00.000Z') })],
      accountId: ACCOUNT_ID,
      axis: 'smbc_balance',
      opening: null,
      manualEntries: [
        { kind: 'manual_correction', enteredAt: new Date('2026-05-21T00:00:00.000Z') },
      ],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.source).toBe('auto')
  })

  it('別の軸のエントリは混ぜない', () => {
    const rows = accountBalanceHistoryRows({
      entries: [
        entry({ axis: 'smbc_balance', value: 1000 }),
        entry({ axis: 'nisa_contribution', value: 5000 }),
      ],
      accountId: ACCOUNT_ID,
      axis: 'nisa_contribution',
      opening: null,
      manualEntries: [],
    })
    expect(rows.map(r => r.valueAfter)).toEqual([5000])
  })

  it('別の口座のエントリは混ぜず、起点にもしない', () => {
    const rows = accountBalanceHistoryRows({
      entries: [
        entry({ value: 1000, occurredAt: new Date('2026-05-10T00:00:00.000Z') }),
        entry({
          accountId: SPOUSE_ACCOUNT_ID,
          value: 5000,
          occurredAt: new Date('2026-05-15T00:00:00.000Z'),
        }),
      ],
      accountId: ACCOUNT_ID,
      axis: 'smbc_balance',
      opening: entry({ accountId: SPOUSE_ACCOUNT_ID, value: 4000 }),
      manualEntries: [],
    })
    expect(rows.map(r => r.valueAfter)).toEqual([1000])
    // 別口座の値を起点にすると、最初の行に本来出ない増減が付く
    expect(rows[0]?.delta).toBeNull()
  })

  it('起点の軸が違えば持ち越さない（増減の起点にしない）', () => {
    const rows = accountBalanceHistoryRows({
      entries: [entry({ value: 1000, occurredAt: new Date('2026-05-10T00:00:00.000Z') })],
      accountId: ACCOUNT_ID,
      axis: 'smbc_balance',
      opening: entry({ axis: 'nisa_contribution', value: 700 }),
      manualEntries: [],
    })
    expect(rows[0]?.delta).toBeNull()
  })
})
