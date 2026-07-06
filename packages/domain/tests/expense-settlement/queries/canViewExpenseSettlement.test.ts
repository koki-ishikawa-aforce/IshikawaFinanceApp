import { describe, it, expect } from 'vitest'
import { canViewExpenseSettlement } from '../../../src/expense-settlement/queries/ExpenseSettlementManagementQuery'
import { ExpenseSettlementManagementViewSchema } from '../../../src/expense-settlement/queries/views/ExpenseSettlementManagementView'

const view = ExpenseSettlementManagementViewSchema.parse({
  userId: 'user_honey' as never,
  currentAccumulations: [],
  currentChildTransactions: [],
  latestFinalizedCycle: null,
})

describe('canViewExpenseSettlement（論点11: 本人のみ可視）', () => {
  it('本人は可視', () => {
    expect(canViewExpenseSettlement(view, 'user_honey' as never)).toBe(true)
  })

  it('配偶者は不可視', () => {
    expect(canViewExpenseSettlement(view, 'user_darling' as never)).toBe(false)
  })
})
