import { describe, it, expect } from 'vitest'
import {
  applyOtherSavingsReturn,
  applyOtherSavingsTransfer,
} from '../../../src/balance-asset-tracking/services/applyOtherSavingsMovement'
import { registerOtherSavingsAccount } from '../../../src/balance-asset-tracking/aggregates/Account'
import {
  InvariantViolationError,
  OtherSavingsMovementAlreadyAppliedError,
} from '../../../src/shared/errors/DomainError'

const TX = '01TXN000000000000000000001' as never
const at = new Date('2026-07-25T03:00:00Z')

const account = () =>
  registerOtherSavingsAccount({
    accountId: '01ACC000000000000000000002' as never,
    ownerUserId: 'user_honey' as never,
    bankName: '楽天銀行' as never,
    initialBalance: 500_000 as never,
    at: new Date('2026-07-01T00:00:00Z'),
  })

describe('applyOtherSavingsTransfer（SMBC → 別銀行貯蓄。シャドウ残高加算）', () => {
  it('移動額だけシャドウ残高が増える', () => {
    const updated = applyOtherSavingsTransfer(account(), {
      transactionId: TX,
      amount: 50_000 as never,
      at,
    })
    expect(updated.balance.currentBalance).toBe(550_000)
  })

  it('同一取引の二度目は拒否される', () => {
    const once = applyOtherSavingsTransfer(account(), {
      transactionId: TX,
      amount: 50_000 as never,
      at,
    })
    expect(() =>
      applyOtherSavingsTransfer(once, { transactionId: TX, amount: 50_000 as never, at }),
    ).toThrow(OtherSavingsMovementAlreadyAppliedError)
  })
})

describe('applyOtherSavingsReturn（別銀行貯蓄 → SMBC。シャドウ残高減算）', () => {
  it('移動額だけシャドウ残高が減る', () => {
    const updated = applyOtherSavingsReturn(account(), {
      transactionId: TX,
      amount: 50_000 as never,
      at,
    })
    expect(updated.balance.currentBalance).toBe(450_000)
  })

  it('同一取引の二度目は拒否される（再実行で二重減算しない）', () => {
    const once = applyOtherSavingsReturn(account(), {
      transactionId: TX,
      amount: 50_000 as never,
      at,
    })
    expect(() =>
      applyOtherSavingsReturn(once, { transactionId: TX, amount: 50_000 as never, at }),
    ).toThrow(OtherSavingsMovementAlreadyAppliedError)
  })

  it('戻しと振込は向きが逆になる（呼び出し側が符号を持たない）', () => {
    const transferred = applyOtherSavingsTransfer(account(), {
      transactionId: TX,
      amount: 50_000 as never,
      at,
    })
    const returned = applyOtherSavingsReturn(account(), {
      transactionId: TX,
      amount: 50_000 as never,
      at,
    })
    expect(transferred.balance.currentBalance - 500_000).toBe(
      -(returned.balance.currentBalance - 500_000),
    )
  })
})

describe('資金移動の金額は正（向きは関数側が決める）', () => {
  it.each([0, -1, -50_000])('%i 円の振込は拒否される', amount => {
    expect(() =>
      applyOtherSavingsTransfer(account(), { transactionId: TX, amount: amount as never, at }),
    ).toThrow(InvariantViolationError)
  })

  it.each([0, -1, -50_000])('%i 円の戻しは拒否される', amount => {
    expect(() =>
      applyOtherSavingsReturn(account(), { transactionId: TX, amount: amount as never, at }),
    ).toThrow(InvariantViolationError)
  })

  it('負の金額を渡しても符号反転で加算に化けない', () => {
    expect(() =>
      applyOtherSavingsReturn(account(), { transactionId: TX, amount: -50_000 as never, at }),
    ).toThrow(InvariantViolationError)
  })
})
