/**
 * DATABASE_URL 未設定時（開発モード）のインメモリ Repository 実装。
 * プロセス再起動でデータは消える。永続化・一意制約の最終保証は PostgreSQL 実装側が担う。
 */
import {
  concludesDelivery,
  deliveryLogOccurredAt,
  InvariantViolationError,
  NOT_JOINED_SHARED_TALK_ROOM,
} from '@warimaru/domain'
import type {
  Account,
  AccountId,
  AccountRepository,
  MitsuiSumitomoUnpaid,
  MitsuiSumitomoUnpaidId,
  MitsuiSumitomoUnpaidRepository,
  AmazonProductKey,
  AppUser,
  AppUserRepository,
  AmazonProductKeyLearningRule,
  AmazonProductKeyLearningRuleRepository,
  BalanceAxis,
  BalanceHistoryEntry,
  BalanceHistoryRepository,
  BankDeposit,
  BankDepositId,
  BankDepositRepository,
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
  ConsecutiveFailureCounter,
  ConsecutiveFailureCounterRepository,
  DeliveryLogId,
  DeliveryMessage,
  DeliveryMessageId,
  DeliveryMessageRepository,
  FailsafeEmail,
  FailsafeEmailId,
  FailsafeEmailRepository,
  FailureCounterRef,
  LineDeliveryLog,
  LineDeliveryLogRepository,
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
  GmailOAuthToken,
  GmailOAuthTokenRepository,
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
  MonthlyReport,
  MonthlyReportId,
  MonthlyReportRepository,
  PdfToCsvConverter,
  ProratedChildTransaction,
  ProratedChildTransactionRepository,
  JoinedSharedTalkRoom,
  RetroactiveCandidateQuery,
  SharedTalkRoom,
  SharedTalkRoomRepository,
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
  UserRole,
  YearMonth,
} from '@warimaru/domain'

/** JST（UTC+9）暦日ベースの 'YYYY-MM' / 'YYYY-MM-DD'（PostgreSQL 実装の月境界規約に合わせる） */
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

/**
 * 開発プレビュー用のスタブ変換（Anthropic API を呼ばず固定明細を返す）。
 * 実変換の検証は DATABASE_URL + ANTHROPIC_API_KEY を設定した実 DB 構成で行う。
 */
export function createMockPdfToCsvConverter(): PdfToCsvConverter {
  return {
    async convert() {
      const now = new Date()
      const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      const day = 24 * 60 * 60 * 1000
      return {
        ok: true,
        rows: [
          {
            occurredAt: new Date(monthStart + 4 * day),
            merchantName: 'モックスーパー',
            amount: 1200,
            pageNumber: 1,
          },
          {
            occurredAt: new Date(monthStart + 6 * day),
            merchantName: 'モックカフェ',
            amount: 800,
            pageNumber: 1,
          },
        ],
      }
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
      // PostgreSQL 実装の unique (user_id, target_year_month) と同じ失敗モードを再現する
      // （読み出し → 存在確認 → 保存の間に別経路が同じ月を作った場合の結末を api 層で再現できる）
      const conflict = [...store.values()].find(
        c =>
          c.common.userId === cycle.common.userId &&
          c.common.targetYearMonth === cycle.common.targetYearMonth &&
          c.common.monthlyExpenseCycleId !== cycle.common.monthlyExpenseCycleId,
      )
      if (conflict !== undefined) {
        throw new InvariantViolationError(
          `月次経費サイクルはユーザー + 対象年月で一意: (${cycle.common.userId}, ${cycle.common.targetYearMonth}) は既に存在する`,
        )
      }
      store.set(cycle.common.monthlyExpenseCycleId, cycle)
    },
  }
}

export function createMockMonthlyReportRepository(): MonthlyReportRepository {
  const store = new Map<string, MonthlyReport>()
  return {
    async findById(id: MonthlyReportId) {
      return store.get(id) ?? null
    },
    async findByMonth(month: YearMonth) {
      // target_year_month UNIQUE（PostgreSQL 実装と同じく 0..1 件）
      return [...store.values()].find(r => r.common.targetYearMonth === month) ?? null
    },
    async save(report: MonthlyReport) {
      // target_year_month UNIQUE を PostgreSQL 実装と同じ失敗モードで再現する
      const conflict = [...store.values()].find(
        r =>
          r.common.targetYearMonth === report.common.targetYearMonth &&
          r.common.monthlyReportId !== report.common.monthlyReportId,
      )
      if (conflict !== undefined) {
        throw new InvariantViolationError(
          `月次レポートは 1 月 1 件（世帯）: ${report.common.targetYearMonth} は既に存在する`,
        )
      }
      store.set(report.common.monthlyReportId, report)
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

export function createMockAccountRepository(): AccountRepository {
  const store = new Map<string, Account>()
  return {
    async findById(id: AccountId) {
      return store.get(id) ?? null
    },
    async findByOwner(ownerId: UserId) {
      return [...store.values()]
        .filter(a => a.common.ownerUserId === ownerId)
        .sort((a, b) => a.kind.localeCompare(b.kind))
    },
    async save(account: Account) {
      // PostgreSQL 実装の UNIQUE (owner_user_id, kind) と同じ失敗モードを再現する
      const conflict = [...store.values()].find(
        a =>
          a.common.ownerUserId === account.common.ownerUserId &&
          a.kind === account.kind &&
          a.common.accountId !== account.common.accountId,
      )
      if (conflict !== undefined) {
        throw new InvariantViolationError(
          `同一ユーザー × 口座種別は一意: (${account.common.ownerUserId}, ${account.kind}) は既に存在する`,
        )
      }
      store.set(account.common.accountId, account)
    },
  }
}

export function createMockBankDepositRepository(): BankDepositRepository {
  const store = new Map<string, BankDeposit>()
  return {
    async findById(id: BankDepositId) {
      return store.get(id) ?? null
    },
    async findByTransactionId(transactionId: TransactionId) {
      return [...store.values()].find(d => d.common.transactionId === transactionId) ?? null
    },
    async findAwaitingManualConfirmationByUser(userId: UserId) {
      return [...store.values()]
        .filter(d => d.common.userId === userId && d.kind === 'unknown')
        .sort(
          (a, b) =>
            a.common.occurredAt.getTime() - b.common.occurredAt.getTime() ||
            a.common.bankDepositId.localeCompare(b.common.bankDepositId),
        )
    },
    async save(deposit: BankDeposit) {
      // PostgreSQL 実装の UNIQUE (transaction_id) と同じ失敗モードを再現する
      const conflict = [...store.values()].find(
        d =>
          d.common.transactionId === deposit.common.transactionId &&
          d.common.bankDepositId !== deposit.common.bankDepositId,
      )
      if (conflict !== undefined) {
        throw new InvariantViolationError(
          `取引ID は一意: ${deposit.common.transactionId} の入金は既に存在する`,
        )
      }
      store.set(deposit.common.bankDepositId, deposit)
    },
  }
}

export function createMockBalanceHistoryRepository(): BalanceHistoryRepository {
  const store = new Map<string, BalanceHistoryEntry>()
  /** PostgreSQL 実装の UNIQUE (axis, source_event_id) と同じ冪等キー */
  const dedupeKey = (entry: BalanceHistoryEntry): string => `${entry.axis} ${entry.sourceEventId}`
  const sorted = (entries: BalanceHistoryEntry[]): BalanceHistoryEntry[] =>
    [...entries].sort(
      (a, b) =>
        a.occurredAt.getTime() - b.occurredAt.getTime() || a.entryId.localeCompare(b.entryId),
    )
  return {
    async append(entry: BalanceHistoryEntry) {
      // 記録済みの変動（同一イベントの再配信）は何もしない
      if (store.has(dedupeKey(entry))) return
      store.set(dedupeKey(entry), entry)
    },
    async findByOccurredAtRange(from: Date, toExclusive: Date) {
      return sorted(
        [...store.values()].filter(e => e.occurredAt >= from && e.occurredAt < toExclusive),
      )
    },
    async findLatestBefore(axis: BalanceAxis, atExclusive: Date) {
      const candidates = sorted(
        [...store.values()].filter(e => e.axis === axis && e.occurredAt < atExclusive),
      )
      return candidates.at(-1) ?? null
    },
  }
}

export function createMockAppUserRepository(): AppUserRepository {
  const store = new Map<string, AppUser>()
  return {
    async findById(id: UserId) {
      return store.get(id) ?? null
    },
    async findByRole(role: UserRole) {
      return [...store.values()].find(u => u.common.role === role) ?? null
    },
    async save(user: AppUser) {
      // PostgreSQL 実装の unique (role) と同じ「Honey / Darling 各 1 名」を模倣する
      const conflict = [...store.values()].find(
        u => u.common.role === user.common.role && u.common.userId !== user.common.userId,
      )
      if (conflict !== undefined) {
        throw new InvariantViolationError(
          `役割 ${user.common.role} のユーザーは既に存在する（Honey / Darling 各 1 名）`,
        )
      }
      store.set(user.common.userId, user)
    },
  }
}

export function createMockGmailOAuthTokenRepository(): GmailOAuthTokenRepository {
  const store = new Map<string, GmailOAuthToken>()
  return {
    async findByUserId(userId: UserId) {
      return store.get(userId) ?? null
    },
    async save(token: GmailOAuthToken) {
      store.set(token.userId, token)
    },
  }
}

/** 共通トークルーム（世帯レベル・シングルトン、OQ-55 ①） */
export function createMockSharedTalkRoomRepository(): SharedTalkRoomRepository {
  let room: SharedTalkRoom = NOT_JOINED_SHARED_TALK_ROOM
  return {
    async find() {
      return room
    },
    async save(next: JoinedSharedTalkRoom) {
      room = next
    },
  }
}

// --- 通知配信 (#36) ---

export function createMockDeliveryMessageRepository(): DeliveryMessageRepository {
  const store = new Map<DeliveryMessageId, DeliveryMessage>()
  return {
    async findById(id: DeliveryMessageId) {
      return store.get(id) ?? null
    },
    async save(message: DeliveryMessage) {
      store.set(message.common.deliveryMessageId, message)
    },
  }
}

export function createMockLineDeliveryLogRepository(): LineDeliveryLogRepository {
  const store = new Map<DeliveryLogId, LineDeliveryLog>()
  return {
    async findById(id: DeliveryLogId) {
      return store.get(id) ?? null
    },
    async findAllByIdempotencyKey(idempotencyKey: string) {
      // Postgres 実装と同じく発生日時の昇順で返す（Map の挿入順 = 保存順を
      // 安定ソートするので、発生日時が同じなら保存順が保たれる）
      return [...store.values()]
        .filter(log => log.idempotencyKey === idempotencyKey)
        .sort((a, b) => deliveryLogOccurredAt(a).getTime() - deliveryLogOccurredAt(b).getTime())
    },
    async save(log: LineDeliveryLog) {
      // append-only + 確定済み配信の idempotency_key partial unique を
      // PostgreSQL 実装と同じ失敗モードで再現する（失敗ログは何件でも積める）
      const conflict = [...store.values()].find(
        existing =>
          existing.deliveryLogId === log.deliveryLogId ||
          (existing.idempotencyKey === log.idempotencyKey &&
            concludesDelivery(existing) &&
            concludesDelivery(log)),
      )
      if (conflict !== undefined) {
        throw new InvariantViolationError(
          `LINE配信ログは不変の監査レコード（append-only）: ${log.deliveryLogId} / 冪等性キー ${log.idempotencyKey} の配信は既に確定済み`,
        )
      }
      store.set(log.deliveryLogId, log)
    },
  }
}

export function createMockFailsafeEmailRepository(): FailsafeEmailRepository {
  const store = new Map<FailsafeEmailId, FailsafeEmail>()
  return {
    async findById(id: FailsafeEmailId) {
      return store.get(id) ?? null
    },
    async save(email: FailsafeEmail) {
      store.set(email.common.failsafeEmailId, email)
    },
  }
}

export function createMockConsecutiveFailureCounterRepository(): ConsecutiveFailureCounterRepository {
  const store = new Map<string, ConsecutiveFailureCounter>()
  const keyOf = (ref: FailureCounterRef): string =>
    ref.kind === 'user' ? `user:${ref.userId}` : `talk_room:${ref.talkRoomId}`
  return {
    async findByRef(ref: FailureCounterRef) {
      return store.get(keyOf(ref)) ?? null
    },
    async save(counter: ConsecutiveFailureCounter) {
      store.set(keyOf(counter.counterRef), counter)
    },
  }
}

export function createMockMitsuiSumitomoUnpaidRepository(): MitsuiSumitomoUnpaidRepository {
  const store = new Map<string, MitsuiSumitomoUnpaid>()
  return {
    async findById(id: MitsuiSumitomoUnpaidId) {
      return store.get(id) ?? null
    },
    async findByCardAccountId(accountId: AccountId) {
      return [...store.values()].find(u => u.accountId === accountId) ?? null
    },
    async save(unpaid: MitsuiSumitomoUnpaid) {
      store.set(unpaid.unpaidAggregateId, unpaid)
    },
  }
}
