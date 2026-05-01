import { describe, it, expect } from 'vitest'
import {
  // shared
  TransactionIdSchema,
  UserIdSchema,
  AccountIdSchema,
  MoneySchema,
  YearMonthSchema,
  ExpenseClassSchema,
  DomainEventBaseSchema,
  DomainError,
  InvariantViolationError,
  NotFoundError,
  PermissionDeniedError,
  // household-analysis
  TransactionSchema,
  MonthlyReportSchema,
  ImportSourceSchema,
  ClassificationBasisSchema,
  ViewerContextSchema,
  ViewerRoleSchema,
  // balance-asset-tracking
  AccountSchema,
  MitsuiSumitomoUnpaidSchema,
  BankNameSchema,
  BrokerageNameSchema,
  brokerageNameToDisplay,
  // events
  MonthlyReportCsvConfirmedSchema,
  MonthlyReportFinalizedSchema,
  TransactionDeletedSchema,
  AccountBalanceUpdatedSchema,
  UnpaidBookkeptSchema,
  UnpaidSettledSchema,
  NisaContributionAddedSchema,
} from '../../src'

describe('@household/domain 公開 API', () => {
  it('全 schema / class が import できる', () => {
    // schema 群
    expect(TransactionIdSchema).toBeDefined()
    expect(UserIdSchema).toBeDefined()
    expect(AccountIdSchema).toBeDefined()
    expect(MoneySchema).toBeDefined()
    expect(YearMonthSchema).toBeDefined()
    expect(ExpenseClassSchema).toBeDefined()
    expect(DomainEventBaseSchema).toBeDefined()
    expect(TransactionSchema).toBeDefined()
    expect(MonthlyReportSchema).toBeDefined()
    expect(ImportSourceSchema).toBeDefined()
    expect(ClassificationBasisSchema).toBeDefined()
    expect(ViewerContextSchema).toBeDefined()
    expect(ViewerRoleSchema).toBeDefined()
    expect(AccountSchema).toBeDefined()
    expect(MitsuiSumitomoUnpaidSchema).toBeDefined()
    expect(BankNameSchema).toBeDefined()
    expect(BrokerageNameSchema).toBeDefined()
    expect(brokerageNameToDisplay).toBeDefined()
    expect(MonthlyReportCsvConfirmedSchema).toBeDefined()
    expect(MonthlyReportFinalizedSchema).toBeDefined()
    expect(TransactionDeletedSchema).toBeDefined()
    expect(AccountBalanceUpdatedSchema).toBeDefined()
    expect(UnpaidBookkeptSchema).toBeDefined()
    expect(UnpaidSettledSchema).toBeDefined()
    expect(NisaContributionAddedSchema).toBeDefined()
    // class 群
    expect(DomainError).toBeDefined()
    expect(InvariantViolationError).toBeDefined()
    expect(NotFoundError).toBeDefined()
    expect(PermissionDeniedError).toBeDefined()
  })

  it('brokerageNameToDisplay が動作する', () => {
    expect(brokerageNameToDisplay({ kind: 'sbi' })).toBe('SBI証券')
    expect(brokerageNameToDisplay({ kind: 'rakuten' })).toBe('楽天証券')
    expect(brokerageNameToDisplay({ kind: 'other', customName: 'マネックス証券' })).toBe('マネックス証券')
  })

  it('NotFoundError が正しいメッセージを生成する', () => {
    const err = new NotFoundError('Transaction', 'tx_001')
    expect(err.message).toBe('Transaction not found: tx_001')
    expect(err.name).toBe('NotFoundError')
  })
})
