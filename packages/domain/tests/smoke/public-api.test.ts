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
  // shared (Phase 5 M-A)
  ParameterStorePathSchema,
  AmazonProductKeySchema,
  UserRoleSchema,
  PersonalExpenseClassSchema,
  DefaultExpenseClassSchema,
  UnclassifiedReasonSchema,
  UnapprovedExpenseTransferSchema,
  // auto-classification
  MerchantLearningRuleSchema,
  AmazonProductKeyLearningRuleSchema,
  BulkClassificationSessionSchema,
  ClassificationResultSchema,
  AmazonMatchStateSchema,
  RetroactiveCandidateViewSchema,
  TransactionAutoClassifiedSchema,
  BulkClassificationCompletedSchema,
  // expense-settlement
  MonthlyExpenseCycleSchema,
  ProratedChildTransactionSchema,
  ExpenseReimbursementDepositSchema,
  ExpenseTypeAccumulationSchema,
  SettlementMatchDifferenceSchema,
  ExpenseSettlementManagementViewSchema,
  MonthlyExpenseCycleFinalizedSchema,
  ExpenseDepositMatchedSchema,
  // transaction-import
  TransactionCandidateSchema,
  DailyMailImportBatchSchema,
  StatementImportJobSchema,
  CandidateImportSourceSchema,
  SmbcMailParseResultSchema,
  DuplicationJudgmentSchema,
  CsvImportCompletionViewSchema,
  CsvImportCompletedSchema,
  DuplicateExcludedSchema,
  // onboarding-auth
  AppUserSchema,
  GmailOAuthTokenSchema,
  NicknameSchema,
  Phase2ProgressSchema,
  LineOperationSettingsSchema,
  RoleJudgmentSchema,
  SpouseCompletionResultSchema,
  OperationStartedSchema,
  NicknameChangedSchema,
  GmailOauthRevocationDetectedSchema,
} from '../../src'

describe('@warimaru/domain 公開 API', () => {
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
    // shared (Phase 5 M-A)
    expect(ParameterStorePathSchema).toBeDefined()
    expect(AmazonProductKeySchema).toBeDefined()
    expect(UserRoleSchema).toBeDefined()
    expect(PersonalExpenseClassSchema).toBeDefined()
    expect(DefaultExpenseClassSchema).toBeDefined()
    expect(UnclassifiedReasonSchema).toBeDefined()
    expect(UnapprovedExpenseTransferSchema).toBeDefined()
    // auto-classification
    expect(MerchantLearningRuleSchema).toBeDefined()
    expect(AmazonProductKeyLearningRuleSchema).toBeDefined()
    expect(BulkClassificationSessionSchema).toBeDefined()
    expect(ClassificationResultSchema).toBeDefined()
    expect(AmazonMatchStateSchema).toBeDefined()
    expect(RetroactiveCandidateViewSchema).toBeDefined()
    expect(TransactionAutoClassifiedSchema).toBeDefined()
    expect(BulkClassificationCompletedSchema).toBeDefined()
    // expense-settlement
    expect(MonthlyExpenseCycleSchema).toBeDefined()
    expect(ProratedChildTransactionSchema).toBeDefined()
    expect(ExpenseReimbursementDepositSchema).toBeDefined()
    expect(ExpenseTypeAccumulationSchema).toBeDefined()
    expect(SettlementMatchDifferenceSchema).toBeDefined()
    expect(ExpenseSettlementManagementViewSchema).toBeDefined()
    expect(MonthlyExpenseCycleFinalizedSchema).toBeDefined()
    expect(ExpenseDepositMatchedSchema).toBeDefined()
    // transaction-import
    expect(TransactionCandidateSchema).toBeDefined()
    expect(DailyMailImportBatchSchema).toBeDefined()
    expect(StatementImportJobSchema).toBeDefined()
    expect(CandidateImportSourceSchema).toBeDefined()
    expect(SmbcMailParseResultSchema).toBeDefined()
    expect(DuplicationJudgmentSchema).toBeDefined()
    expect(CsvImportCompletionViewSchema).toBeDefined()
    expect(CsvImportCompletedSchema).toBeDefined()
    expect(DuplicateExcludedSchema).toBeDefined()
    // onboarding-auth
    expect(AppUserSchema).toBeDefined()
    expect(GmailOAuthTokenSchema).toBeDefined()
    expect(NicknameSchema).toBeDefined()
    expect(Phase2ProgressSchema).toBeDefined()
    expect(LineOperationSettingsSchema).toBeDefined()
    expect(RoleJudgmentSchema).toBeDefined()
    expect(SpouseCompletionResultSchema).toBeDefined()
    expect(OperationStartedSchema).toBeDefined()
    expect(NicknameChangedSchema).toBeDefined()
    expect(GmailOauthRevocationDetectedSchema).toBeDefined()
    // class 群
    expect(DomainError).toBeDefined()
    expect(InvariantViolationError).toBeDefined()
    expect(NotFoundError).toBeDefined()
    expect(PermissionDeniedError).toBeDefined()
  })

  it('brokerageNameToDisplay が動作する', () => {
    expect(brokerageNameToDisplay({ kind: 'sbi' })).toBe('SBI証券')
    expect(brokerageNameToDisplay({ kind: 'rakuten' })).toBe('楽天証券')
    expect(brokerageNameToDisplay({ kind: 'other', customName: 'マネックス証券' })).toBe(
      'マネックス証券',
    )
  })

  it('NotFoundError が正しいメッセージを生成する', () => {
    const err = new NotFoundError('Transaction', 'tx_001')
    expect(err.message).toBe('Transaction not found: tx_001')
    expect(err.name).toBe('NotFoundError')
  })
})
