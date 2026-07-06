import { describe, it, expect } from 'vitest'
import {
  ExpenseReimbursementDepositSchema,
  matchDeposit,
  confirmUnrecognizedDeposit,
  type AwaitingMatchDeposit,
} from '../../../src/expense-settlement/aggregates/ExpenseReimbursementDeposit'

const common = {
  expenseReimbursementId: '01RMB000000000000000000001' as never,
  userId: 'user_honey' as never,
  depositAmount: 25000 as never,
  depositedAt: new Date(),
}

describe('ExpenseReimbursementDeposit 集約', () => {
  it('突合待ち入金は parse 成功', () => {
    expect(() =>
      ExpenseReimbursementDepositSchema.parse({
        kind: 'awaiting_match',
        common,
        receivedAt: new Date(),
      }),
    ).not.toThrow()
  })

  it('突合済みは突合対象サイクルID が必須（欠落で parse 失敗）', () => {
    expect(() =>
      ExpenseReimbursementDepositSchema.parse({
        kind: 'matched',
        common,
        matchedAt: new Date(),
      }),
    ).toThrow()
  })

  it('matchDeposit / confirmUnrecognizedDeposit: 突合待ち → 突合済み → 不認定分確定済み', () => {
    const awaiting = ExpenseReimbursementDepositSchema.parse({
      kind: 'awaiting_match',
      common,
      receivedAt: new Date(),
    }) as AwaitingMatchDeposit
    const matched = matchDeposit(awaiting, '01CYC000000000000000000001' as never, new Date())
    expect(matched.kind).toBe('matched')
    expect(matched.matchedCycleId).toBe('01CYC000000000000000000001')
    const confirmed = confirmUnrecognizedDeposit(matched, 3000 as never, new Date())
    expect(confirmed.kind).toBe('unrecognized_confirmed')
    expect(confirmed.unapprovedTotal).toBe(3000)
  })
})
