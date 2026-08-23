import { describe, it, expect } from 'vitest'
import {
  MitsuiSumitomoUnpaidSchema,
  bookUnpaid,
  openMitsuiSumitomoUnpaid,
  settleUnpaid,
  settledEntriesForNotice,
  settledTotalForNotice,
} from '../../../src/balance-asset-tracking/aggregates/MitsuiSumitomoUnpaid'
import {
  UnpaidAlreadyBookedError,
  InvariantViolationError,
  UnpaidSettlementAlreadyAppliedError,
} from '../../../src/shared/errors/DomainError'

describe('openMitsuiSumitomoUnpaid()', () => {
  const open = () =>
    openMitsuiSumitomoUnpaid({
      unpaidAggregateId: '01NP0000000000000000000001' as never,
      accountId: '01ACC000000000000000000001' as never,
    })

  it('未払金なし・未消込の集約として開設される', () => {
    const unpaid = open()
    expect(unpaid.unpaidAggregateId).toBe('01NP0000000000000000000001')
    expect(unpaid.accountId).toBe('01ACC000000000000000000001')
    expect(unpaid.currentMonthUnpaidTotal).toBe(0)
    expect(unpaid.entries).toEqual([])
    expect(unpaid.lastSettledAt).toBeNull()
  })

  it('開設直後の集約にカード利用を計上できる（登録経路がそのまま取込につながる）', () => {
    const booked = bookUnpaid(open(), {
      entryId: '01ENT000000000000000000001' as never,
      transactionId: '01TX0000000000000000000001' as never,
      amount: 3000 as never,
      bookedAt: new Date('2026-07-10'),
    })
    expect(booked.currentMonthUnpaidTotal).toBe(3000)
    expect(booked.entries).toHaveLength(1)
  })
})

describe('MitsuiSumitomoUnpaid 集約', () => {
  it('当月未払金合計 = Σ 計上中エントリ金額が一致すれば parse 成功', () => {
    expect(() =>
      MitsuiSumitomoUnpaidSchema.parse({
        unpaidAggregateId: '01NP0000000000000000000001' as never,
        accountId: '01ACC000000000000000000001' as never,
        currentMonthUnpaidTotal: 8000 as never,
        entries: [
          {
            kind: 'booked',
            entryId: '01ENT000000000000000000001' as never,
            transactionId: '01TX0000000000000000000001' as never,
            bookedAt: new Date(),
            amount: 3000 as never,
          },
          {
            kind: 'booked',
            entryId: '01ENT000000000000000000002' as never,
            transactionId: '01TX0000000000000000000002' as never,
            bookedAt: new Date(),
            amount: 5000 as never,
          },
        ],
        lastSettledAt: null,
      }),
    ).not.toThrow()
  })

  it('当月未払金合計 ≠ Σ 計上中エントリ金額なら parse 失敗', () => {
    expect(() =>
      MitsuiSumitomoUnpaidSchema.parse({
        unpaidAggregateId: '01NP0000000000000000000001' as never,
        accountId: '01ACC000000000000000000001' as never,
        currentMonthUnpaidTotal: 10000 as never,
        entries: [
          {
            kind: 'booked',
            entryId: '01ENT000000000000000000001' as never,
            transactionId: '01TX0000000000000000000001' as never,
            bookedAt: new Date(),
            amount: 3000 as never,
          },
          {
            kind: 'booked',
            entryId: '01ENT000000000000000000002' as never,
            transactionId: '01TX0000000000000000000002' as never,
            bookedAt: new Date(),
            amount: 5000 as never,
          },
        ],
        lastSettledAt: null,
      }),
    ).toThrow()
  })

  it('引落消込済みエントリは合計に含めない（消込後 currentMonthUnpaidTotal=0）', () => {
    expect(() =>
      MitsuiSumitomoUnpaidSchema.parse({
        unpaidAggregateId: '01NP0000000000000000000001' as never,
        accountId: '01ACC000000000000000000001' as never,
        currentMonthUnpaidTotal: 0 as never,
        entries: [
          {
            kind: 'settled',
            entryId: '01ENT000000000000000000001' as never,
            transactionId: '01TX0000000000000000000001' as never,
            bookedAt: new Date(),
            settledAt: new Date(),
            amount: 3000 as never,
            settlementNoticeId: 'notice_001' as never,
          },
        ],
        lastSettledAt: new Date(),
      }),
    ).not.toThrow()
  })

  it('未払金エントリ無し（initial 状態）も parse 成功', () => {
    expect(() =>
      MitsuiSumitomoUnpaidSchema.parse({
        unpaidAggregateId: '01NP0000000000000000000001' as never,
        accountId: '01ACC000000000000000000001' as never,
        currentMonthUnpaidTotal: 0 as never,
        entries: [],
        lastSettledAt: null,
      }),
    ).not.toThrow()
  })
})

// --- #65: 未払金の計上・消込 ---

const emptyUnpaid = () =>
  MitsuiSumitomoUnpaidSchema.parse({
    unpaidAggregateId: '01NP0000000000000000000001' as never,
    accountId: '01ACC000000000000000000001' as never,
    currentMonthUnpaidTotal: 0 as never,
    entries: [],
    lastSettledAt: null,
  })

describe('bookUnpaid()', () => {
  it('計上中エントリを追加し、当月未払金合計に加算する', () => {
    const booked = bookUnpaid(emptyUnpaid(), {
      entryId: '01ENT000000000000000000001' as never,
      transactionId: '01TX0000000000000000000001' as never,
      amount: 3000 as never,
      bookedAt: new Date('2026-04-10'),
    })
    const again = bookUnpaid(booked, {
      entryId: '01ENT000000000000000000002' as never,
      transactionId: '01TX0000000000000000000002' as never,
      amount: 5000 as never,
      bookedAt: new Date('2026-04-12'),
    })

    expect(again.currentMonthUnpaidTotal).toBe(8000)
    expect(again.entries).toHaveLength(2)
    expect(again.entries.every(e => e.kind === 'booked')).toBe(true)
  })

  it('同一取引IDの二重計上は InvariantViolationError', () => {
    const booked = bookUnpaid(emptyUnpaid(), {
      entryId: '01ENT000000000000000000001' as never,
      transactionId: '01TX0000000000000000000001' as never,
      amount: 3000 as never,
      bookedAt: new Date('2026-04-10'),
    })
    expect(() =>
      bookUnpaid(booked, {
        entryId: '01ENT000000000000000000002' as never,
        transactionId: '01TX0000000000000000000001' as never,
        amount: 3000 as never,
        bookedAt: new Date('2026-04-11'),
      }),
    ).toThrow(InvariantViolationError)
  })

  it('二重計上のエラーは専用型 UnpaidAlreadyBookedError で判別できる（#388）', () => {
    const booked = bookUnpaid(emptyUnpaid(), {
      entryId: '01ENT000000000000000000001' as never,
      transactionId: '01TX0000000000000000000001' as never,
      amount: 3000 as never,
      bookedAt: new Date('2026-04-10'),
    })
    expect(() =>
      bookUnpaid(booked, {
        entryId: '01ENT000000000000000000002' as never,
        transactionId: '01TX0000000000000000000001' as never,
        amount: 3000 as never,
        bookedAt: new Date('2026-04-11'),
      }),
    ).toThrow(UnpaidAlreadyBookedError)
  })
})

describe('settleUnpaid()', () => {
  const bookedTwo = () =>
    bookUnpaid(
      bookUnpaid(emptyUnpaid(), {
        entryId: '01ENT000000000000000000001' as never,
        transactionId: '01TX0000000000000000000001' as never,
        amount: 3000 as never,
        bookedAt: new Date('2026-04-10'),
      }),
      {
        entryId: '01ENT000000000000000000002' as never,
        transactionId: '01TX0000000000000000000002' as never,
        amount: 5000 as never,
        bookedAt: new Date('2026-04-12'),
      },
    )

  it('全計上中エントリを引落消込済みに遷移し、当月未払金合計は 0 になる', () => {
    const settledAt = new Date('2026-05-26')
    const { unpaid, settledEntries, settledTotal } = settleUnpaid(
      bookedTwo(),
      'notice_202605' as never,
      settledAt,
    )

    expect(unpaid.currentMonthUnpaidTotal).toBe(0)
    expect(unpaid.entries).toHaveLength(2)
    expect(unpaid.entries.every(e => e.kind === 'settled')).toBe(true)
    expect(unpaid.lastSettledAt).toEqual(settledAt)
    expect(settledEntries).toHaveLength(2)
    expect(settledEntries.every(e => e.settlementNoticeId === 'notice_202605')).toBe(true)
    expect(settledTotal).toBe(8000)
  })

  it('消込後にさらに計上→消込すると、過去の消込済みエントリは保持される', () => {
    const first = settleUnpaid(bookedTwo(), 'notice_202605' as never, new Date('2026-05-26'))
    const rebooked = bookUnpaid(first.unpaid, {
      entryId: '01ENT000000000000000000003' as never,
      transactionId: '01TX0000000000000000000003' as never,
      amount: 2000 as never,
      bookedAt: new Date('2026-06-01'),
    })
    const second = settleUnpaid(rebooked, 'notice_202606' as never, new Date('2026-06-26'))

    expect(second.unpaid.entries).toHaveLength(3)
    expect(second.settledTotal).toBe(2000)
    expect(second.unpaid.currentMonthUnpaidTotal).toBe(0)
  })

  it('同一 settlementNoticeId の重複適用は InvariantViolationError（冪等性）', () => {
    const first = settleUnpaid(bookedTwo(), 'notice_202605' as never, new Date('2026-05-26'))
    const rebooked = bookUnpaid(first.unpaid, {
      entryId: '01ENT000000000000000000003' as never,
      transactionId: '01TX0000000000000000000003' as never,
      amount: 2000 as never,
      bookedAt: new Date('2026-06-01'),
    })
    expect(() => settleUnpaid(rebooked, 'notice_202605' as never, new Date('2026-06-26'))).toThrow(
      InvariantViolationError,
    )
  })

  it('計上中エントリが 0 件なら InvariantViolationError', () => {
    expect(() => settleUnpaid(emptyUnpaid(), 'notice_202605' as never, new Date())).toThrow(
      InvariantViolationError,
    )
  })

  it('重複適用のエラーは専用型 UnpaidSettlementAlreadyAppliedError で判別できる（#388）', () => {
    const first = settleUnpaid(bookedTwo(), 'notice_202605' as never, new Date('2026-05-26'))
    const rebooked = bookUnpaid(first.unpaid, {
      entryId: '01ENT000000000000000000003' as never,
      transactionId: '01TX0000000000000000000003' as never,
      amount: 2000 as never,
      bookedAt: new Date('2026-06-01'),
    })
    expect(() => settleUnpaid(rebooked, 'notice_202605' as never, new Date('2026-06-26'))).toThrow(
      UnpaidSettlementAlreadyAppliedError,
    )
  })

  it('計上中エントリ 0 件のエラーは「適用済み」と別型（スキップ扱いにしてはいけない）', () => {
    // `.not.toThrow(Class)` は何も throw しなくても通るため、捕捉した例外そのものを見る
    let caught: unknown
    try {
      settleUnpaid(emptyUnpaid(), 'notice_202605' as never, new Date())
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(InvariantViolationError)
    expect(caught).not.toBeInstanceOf(UnpaidSettlementAlreadyAppliedError)
  })
})

// --- #388: 通知IDから消込対象を引き直す（再実行時の残高反映に使う） ---

describe('settledEntriesForNotice() / settledTotalForNotice()', () => {
  const bookedTwo = () =>
    bookUnpaid(
      bookUnpaid(emptyUnpaid(), {
        entryId: '01ENT000000000000000000001' as never,
        transactionId: '01TX0000000000000000000001' as never,
        amount: 3000 as never,
        bookedAt: new Date('2026-04-10'),
      }),
      {
        entryId: '01ENT000000000000000000002' as never,
        transactionId: '01TX0000000000000000000002' as never,
        amount: 5000 as never,
        bookedAt: new Date('2026-04-12'),
      },
    )

  it('消込済み集約から、その通知で消し込んだ合計を再計算できる', () => {
    const { unpaid } = settleUnpaid(bookedTwo(), 'notice_202605' as never, new Date('2026-05-26'))

    expect(settledTotalForNotice(unpaid, 'notice_202605' as never)).toBe(8000)
    expect(settledEntriesForNotice(unpaid, 'notice_202605' as never)).toHaveLength(2)
  })

  it('複数月ぶんが混在しても、指定した通知のぶんだけを合計する', () => {
    const may = settleUnpaid(bookedTwo(), 'notice_202605' as never, new Date('2026-05-26'))
    const rebooked = bookUnpaid(may.unpaid, {
      entryId: '01ENT000000000000000000003' as never,
      transactionId: '01TX0000000000000000000003' as never,
      amount: 2000 as never,
      bookedAt: new Date('2026-06-01'),
    })
    const june = settleUnpaid(rebooked, 'notice_202606' as never, new Date('2026-06-26'))

    expect(settledTotalForNotice(june.unpaid, 'notice_202605' as never)).toBe(8000)
    expect(settledTotalForNotice(june.unpaid, 'notice_202606' as never)).toBe(2000)
  })

  it('未知の通知IDでは 0 を返す（計上中エントリを巻き込まない）', () => {
    expect(settledTotalForNotice(bookedTwo(), 'notice_999999' as never)).toBe(0)
    expect(settledEntriesForNotice(bookedTwo(), 'notice_999999' as never)).toHaveLength(0)
  })
})
