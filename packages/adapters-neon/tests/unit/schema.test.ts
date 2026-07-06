import { describe, it, expect } from 'vitest'
import { getTableName } from 'drizzle-orm'
import { transactions, monthlyReports, accounts, mitsuiSumitomoUnpaids } from '../../src/schema'

describe('Drizzle スキーマ定義（M-B spec §4 第 1 波）', () => {
  it('4 テーブルが spec どおりの snake_case 複数形テーブル名を持つ', () => {
    expect(getTableName(transactions)).toBe('transactions')
    expect(getTableName(monthlyReports)).toBe('monthly_reports')
    expect(getTableName(accounts)).toBe('accounts')
    expect(getTableName(mitsuiSumitomoUnpaids)).toBe('mitsui_sumitomo_unpaids')
  })

  it('昇格カラムがドメインのフィールド名と機械的に対応する（§3 命名規約）', () => {
    expect(transactions.ownerUserId.name).toBe('owner_user_id')
    expect(transactions.occurredAt.name).toBe('occurred_at')
    expect(monthlyReports.targetYearMonth.name).toBe('target_year_month')
    expect(accounts.isActive.name).toBe('is_active')
    expect(mitsuiSumitomoUnpaids.currentMonthUnpaidTotal.name).toBe('current_month_unpaid_total')
  })
})
