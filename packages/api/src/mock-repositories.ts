/**
 * DATABASE_URL 未設定時（開発モード）のインメモリ Repository 実装。
 * プロセス再起動でデータは消える。永続化・一意制約の最終保証は Neon 実装側が担う。
 */
import type {
  AmazonProductKey,
  AmazonProductKeyLearningRule,
  AmazonProductKeyLearningRuleRepository,
  BulkClassificationSession,
  BulkClassificationSessionId,
  BulkClassificationSessionRepository,
  CategoryDeletionRequest,
  CategoryDeletionRequestId,
  CategoryDeletionRequestRepository,
  CategoryId,
  CategoryMaster,
  CategoryMasterRepository,
  ChildTransactionId,
  ClassifiedTransaction,
  DailyMailImportBatch,
  DailyMailImportBatchRepository,
  ExpenseReimbursementDeposit,
  ExpenseReimbursementDepositRepository,
  ExpenseReimbursementId,
  ExpenseTypeDeletionRequest,
  ExpenseTypeDeletionRequestId,
  ExpenseTypeDeletionRequestRepository,
  ExpenseTypeId,
  ExpenseTypeMaster,
  ExpenseTypeMasterRepository,
  GmailMessageId,
  ImportBatchId,
  ImportJobId,
  MerchantLearningRule,
  MerchantLearningRuleRepository,
  Money,
  MonthlyExpenseCycle,
  MonthlyExpenseCycleId,
  MonthlyExpenseCycleRepository,
  MonthlyLimit,
  MonthlyLimitId,
  MonthlyLimitRepository,
  ProratedChildTransaction,
  ProratedChildTransactionRepository,
  RetroactiveCandidateQuery,
  StatementImportJob,
  StatementImportJobRepository,
  Transaction,
  TransactionCandidate,
  TransactionCandidateId,
  TransactionCandidateRepository,
  TransactionId,
  TransactionRepository,
  UploadFileId,
  UserId,
  YearMonth,
} from '@warimaru/domain'

/** JST（UTC+9）暦日ベースの 'YYYY-MM' / 'YYYY-MM-DD'（Neon 実装の月境界規約に合わせる） */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
function jstYearMonth(d: Date): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 7)
}
function jstCalendarDate(d: Date): string {
  return new Date(d.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
}

export function createMockCategoryMasterRepository(): CategoryMasterRepository {
  const store = new Map<string, CategoryMaster>()
  return {
    async findById(id: CategoryId) {
      return store.get(id) ?? null
    },
    async findAllVisibleToUser(userId: UserId) {
      return [...store.values()].filter(
        c => c.scope.kind === 'household_shared' || c.scope.userId === userId,
      )
    },
    async save(category: CategoryMaster) {
      store.set(category.categoryId, category)
    },
    async deleteById(id: CategoryId) {
      store.delete(id)
    },
  }
}

export function createMockExpenseTypeMasterRepository(): ExpenseTypeMasterRepository {
  const store = new Map<string, ExpenseTypeMaster>()
  return {
    async findById(id: ExpenseTypeId) {
      return store.get(id) ?? null
    },
    async findAllVisibleToUser(userId: UserId) {
      return [...store.values()].filter(
        e => e.scope.kind === 'household_shared' || e.scope.userId === userId,
      )
    },
    async save(expenseType: ExpenseTypeMaster) {
      store.set(expenseType.expenseTypeId, expenseType)
    },
    async deleteById(id: ExpenseTypeId) {
      store.delete(id)
    },
  }
}

export function createMockMonthlyLimitRepository(): MonthlyLimitRepository {
  const store = new Map<string, MonthlyLimit>()
  return {
    async findById(id: MonthlyLimitId) {
      return store.get(id) ?? null
    },
    async findByUserAndExpenseType(userId: UserId, expenseTypeId: ExpenseTypeId) {
      return (
        [...store.values()].find(l => l.userId === userId && l.expenseTypeId === expenseTypeId) ??
        null
      )
    },
    async save(limit: MonthlyLimit) {
      store.set(limit.monthlyLimitId, limit)
    },
    async deleteByExpenseType(expenseTypeId: ExpenseTypeId) {
      for (const [id, limit] of store) {
        if (limit.expenseTypeId === expenseTypeId) store.delete(id)
      }
    },
  }
}

export function createMockCategoryDeletionRequestRepository(): CategoryDeletionRequestRepository {
  const store = new Map<string, CategoryDeletionRequest>()
  return {
    async findById(id: CategoryDeletionRequestId) {
      return store.get(id) ?? null
    },
    async save(request: CategoryDeletionRequest) {
      store.set(request.categoryDeletionRequestId, request)
    },
  }
}

export function createMockExpenseTypeDeletionRequestRepository(): ExpenseTypeDeletionRequestRepository {
  const store = new Map<string, ExpenseTypeDeletionRequest>()
  return {
    async findById(id: ExpenseTypeDeletionRequestId) {
      return store.get(id) ?? null
    },
    async save(request: ExpenseTypeDeletionRequest) {
      store.set(request.expenseTypeDeletionRequestId, request)
    },
  }
}

export function createMockTransactionRepository(): TransactionRepository {
  const store = new Map<string, Transaction>()
  return {
    async findById(id: TransactionId) {
      return store.get(id) ?? null
    },
    async findByMonth(ownerId: UserId, month: YearMonth) {
      return [...store.values()].filter(
        t => t.common.ownerUserId === ownerId && jstYearMonth(t.common.occurredAt) === month,
      )
    },
    async findClassifiedByCategory(categoryId: CategoryId) {
      return [...store.values()].filter(
        (t): t is ClassifiedTransaction =>
          t.kind === 'classified' && t.details.categoryId === categoryId,
      )
    },
    async findClassifiedByExpenseType(expenseTypeId: ExpenseTypeId) {
      return [...store.values()].filter(
        (t): t is ClassifiedTransaction =>
          t.kind === 'classified' &&
          t.details.expenseTypeRef.kind === 'business' &&
          t.details.expenseTypeRef.expenseTypeId === expenseTypeId,
      )
    },
    async save(transaction: Transaction) {
      store.set(transaction.common.transactionId, transaction)
    },
  }
}

export function createMockStatementImportJobRepository(): StatementImportJobRepository {
  const store = new Map<string, StatementImportJob>()
  return {
    async findById(id: ImportJobId) {
      return store.get(id) ?? null
    },
    async findByUserAndMonth(uploaderUserId: UserId, targetMonth: YearMonth) {
      return [...store.values()].filter(
        j => j.common.uploaderUserId === uploaderUserId && j.common.targetMonth === targetMonth,
      )
    },
    async save(job: StatementImportJob) {
      store.set(job.common.importJobId, job)
    },
  }
}

export function createMockTransactionCandidateRepository(): TransactionCandidateRepository {
  const store = new Map<string, TransactionCandidate>()
  return {
    async findById(id: TransactionCandidateId) {
      return store.get(id) ?? null
    },
    async findByGmailMessageId(gmailMessageId: GmailMessageId) {
      return (
        [...store.values()].find(c => {
          const source = c.common.importSource
          if (source.kind === 'email') return source.gmailMessageId === gmailMessageId
          if (source.kind === 'amazon_match') return source.smbcGmailMessageId === gmailMessageId
          return false
        }) ?? null
      )
    },
    async findByTripleMatch(userId: UserId, occurredOn: Date, amount: Money, merchantName: string) {
      return (
        [...store.values()].find(
          c =>
            c.common.userId === userId &&
            jstCalendarDate(c.common.occurredAt) === jstCalendarDate(occurredOn) &&
            c.common.amount === amount &&
            c.common.merchantName === merchantName,
        ) ?? null
      )
    },
    async findByCsvFileId(csvFileId: UploadFileId) {
      return [...store.values()].filter(
        c => c.common.importSource.kind === 'csv' && c.common.importSource.csvFileId === csvFileId,
      )
    },
    async findByPdfFileId(pdfFileId: UploadFileId) {
      return [...store.values()].filter(
        c => c.common.importSource.kind === 'pdf' && c.common.importSource.pdfFileId === pdfFileId,
      )
    },
    async save(candidate: TransactionCandidate) {
      store.set(candidate.common.transactionCandidateId, candidate)
    },
  }
}

export function createMockDailyMailImportBatchRepository(): DailyMailImportBatchRepository {
  const store = new Map<string, DailyMailImportBatch>()
  return {
    async findById(id: ImportBatchId) {
      return store.get(id) ?? null
    },
    async findInProgressByUser(userId: UserId) {
      return (
        [...store.values()].find(
          b => b.common.userId === userId && (b.kind === 'started' || b.kind === 'importing'),
        ) ?? null
      )
    },
    async save(batch: DailyMailImportBatch) {
      store.set(batch.common.importBatchId, batch)
    },
  }
}

export function createMockMerchantLearningRuleRepository(): MerchantLearningRuleRepository {
  const store = new Map<string, MerchantLearningRule>()
  const key = (userId: string, merchantName: string): string => `${userId} ${merchantName}`
  return {
    async findByMerchant(userId: UserId, merchantName: string) {
      return store.get(key(userId, merchantName)) ?? null
    },
    async findAllByUser(userId: UserId) {
      return [...store.values()].filter(r => r.common.userId === userId)
    },
    async save(rule: MerchantLearningRule) {
      store.set(key(rule.common.userId, rule.common.merchantName), rule)
    },
  }
}

export function createMockAmazonProductKeyLearningRuleRepository(): AmazonProductKeyLearningRuleRepository {
  const store = new Map<string, AmazonProductKeyLearningRule>()
  const key = (userId: string, productKey: string): string => `${userId} ${productKey}`
  return {
    async findByProductKey(userId: UserId, amazonProductKey: AmazonProductKey) {
      return store.get(key(userId, amazonProductKey)) ?? null
    },
    async findAllByUser(userId: UserId) {
      return [...store.values()].filter(r => r.userId === userId)
    },
    async save(rule: AmazonProductKeyLearningRule) {
      store.set(key(rule.userId, rule.amazonProductKey), rule)
    },
  }
}

export function createMockBulkClassificationSessionRepository(): BulkClassificationSessionRepository {
  const store = new Map<string, BulkClassificationSession>()
  return {
    async findById(id: BulkClassificationSessionId) {
      return store.get(id) ?? null
    },
    async findInProgressByUser(userId: UserId) {
      return (
        [...store.values()].find(s => s.common.userId === userId && s.kind === 'in_progress') ??
        null
      )
    },
    async save(session: BulkClassificationSession) {
      store.set(session.common.bulkClassificationSessionId, session)
    },
  }
}

export function createMockRetroactiveCandidateQuery(): RetroactiveCandidateQuery {
  return {
    async fetchCandidates(userId: UserId, merchantName: string) {
      return { userId, merchantName, candidates: [], proposedAt: new Date() }
    },
  }
}

export function createMockMonthlyExpenseCycleRepository(): MonthlyExpenseCycleRepository {
  const store = new Map<string, MonthlyExpenseCycle>()
  return {
    async findById(id: MonthlyExpenseCycleId) {
      return store.get(id) ?? null
    },
    async findByUserAndMonth(userId: UserId, targetYearMonth: YearMonth) {
      return (
        [...store.values()].find(
          c => c.common.userId === userId && c.common.targetYearMonth === targetYearMonth,
        ) ?? null
      )
    },
    async save(cycle: MonthlyExpenseCycle) {
      store.set(cycle.common.monthlyExpenseCycleId, cycle)
    },
  }
}

export function createMockProratedChildTransactionRepository(): ProratedChildTransactionRepository {
  const store = new Map<string, ProratedChildTransaction>()
  return {
    async findById(id: ChildTransactionId) {
      return store.get(id) ?? null
    },
    async findByParent(parentTransactionId: TransactionId) {
      return [...store.values()].filter(c => c.parentTransactionId === parentTransactionId)
    },
    async save(child: ProratedChildTransaction) {
      store.set(child.childTransactionId, child)
    },
  }
}

export function createMockExpenseReimbursementDepositRepository(): ExpenseReimbursementDepositRepository {
  const store = new Map<string, ExpenseReimbursementDeposit>()
  return {
    async findById(id: ExpenseReimbursementId) {
      return store.get(id) ?? null
    },
    async findAwaitingByUser(userId: UserId) {
      return [...store.values()].filter(
        d => d.common.userId === userId && d.kind === 'awaiting_match',
      )
    },
    async save(deposit: ExpenseReimbursementDeposit) {
      store.set(deposit.common.expenseReimbursementId, deposit)
    },
  }
}
