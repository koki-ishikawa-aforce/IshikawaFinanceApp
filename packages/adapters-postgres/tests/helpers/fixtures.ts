/**
 * 統合テスト用フィクスチャ（ドメインの Schema.parse を通した正規の集約を生成）
 */
import type {
  Account,
  BalanceAxis,
  BalanceHistoryEntry,
  CategoryId,
  MitsuiSumitomoUnpaid,
  MonthlyReport,
  Transaction,
  UserId,
  YearMonth,
} from '@warimaru/domain'
import {
  AccountSchema,
  BalanceHistoryEntrySchema,
  MitsuiSumitomoUnpaidSchema,
  MonthlyReportSchema,
  TransactionSchema,
  YearMonthSchema,
} from '@warimaru/domain'
import { newUlid } from '../../src/newId'

/** UserId は外部由来（LINE userID）のため任意の非空文字列で良い */
export const HONEY_USER_ID = 'U-honey-test' as UserId
export const DARLING_USER_ID = 'U-darling-test' as UserId

export function ym(value: string): YearMonth {
  return YearMonthSchema.parse(value)
}

export function newCategoryId(): CategoryId {
  return newUlid() as CategoryId
}

export interface TransactionFixtureInput {
  ownerUserId?: UserId
  merchantName?: string
  amount?: number
  occurredAt?: Date
  categoryId?: string
  expenseClass?: 'household' | 'personal_honey' | 'personal_darling' | 'business_expense'
  expenseTypeId?: string
}

export function classifiedTransaction(input: TransactionFixtureInput = {}): Transaction {
  const expenseClass = input.expenseClass ?? 'household'
  return TransactionSchema.parse({
    kind: 'classified',
    common: {
      transactionId: newUlid(),
      ownerUserId: input.ownerUserId ?? HONEY_USER_ID,
      merchantName: input.merchantName ?? 'テストスーパー',
      amount: input.amount ?? 1200,
      occurredAt: input.occurredAt ?? new Date('2026-07-05T03:00:00.000Z'),
      importSource: {
        kind: 'manual',
        enteredAt: new Date('2026-07-05T04:00:00.000Z'),
        enteredByUserId: input.ownerUserId ?? HONEY_USER_ID,
      },
    },
    details: {
      categoryId: input.categoryId ?? newUlid(),
      expenseClass,
      expenseTypeRef:
        expenseClass === 'business_expense'
          ? { kind: 'business', expenseTypeId: input.expenseTypeId ?? newUlid() }
          : { kind: 'non_business' },
      basis: {
        kind: 'user_manual',
        modifiedByUserId: input.ownerUserId ?? HONEY_USER_ID,
        modifiedAt: new Date('2026-07-05T05:00:00.000Z'),
      },
    },
  })
}

export function unclassifiedTransaction(
  input: Pick<TransactionFixtureInput, 'ownerUserId' | 'merchantName' | 'amount' | 'occurredAt'> & {
    defaultExpenseClass?: 'personal_honey' | 'personal_darling'
  } = {},
): Transaction {
  return TransactionSchema.parse({
    kind: 'unclassified',
    common: {
      transactionId: newUlid(),
      ownerUserId: input.ownerUserId ?? HONEY_USER_ID,
      merchantName: input.merchantName ?? '未分類ストア',
      amount: input.amount ?? 800,
      occurredAt: input.occurredAt ?? new Date('2026-07-10T03:00:00.000Z'),
      importSource: { kind: 'email', gmailMessageId: `gm-${newUlid()}` },
    },
    reason: 'merchant_rule_unlearned',
    defaultExpenseClass: input.defaultExpenseClass ?? 'personal_honey',
  })
}

export function deletedTransaction(
  input: Pick<TransactionFixtureInput, 'ownerUserId' | 'occurredAt'> = {},
): Transaction {
  return TransactionSchema.parse({
    kind: 'deleted',
    common: {
      transactionId: newUlid(),
      ownerUserId: input.ownerUserId ?? HONEY_USER_ID,
      merchantName: '削除済みストア',
      amount: 500,
      occurredAt: input.occurredAt ?? new Date('2026-07-15T03:00:00.000Z'),
      importSource: {
        kind: 'csv',
        csvFileId: newUlid(),
        rowNumber: 3,
      },
    },
    deletedAt: new Date('2026-07-16T00:00:00.000Z'),
    deletionReason: 'user_deleted',
  })
}

export function csvConfirmedReport(input: { targetYearMonth?: YearMonth } = {}): MonthlyReport {
  const categoryId = newUlid()
  return MonthlyReportSchema.parse({
    kind: 'csv_confirmed',
    common: {
      monthlyReportId: newUlid(),
      targetYearMonth: input.targetYearMonth ?? ym('2026-06'),
      householdCategoryTotals: [{ categoryId, total: 45000 }],
      personalTotalHoney: 12000,
      personalTotalDarling: 9000,
      businessExpenseTotalHoney: 3000,
      businessExpenseTotalDarling: 0,
      nisaContributionAccumulated: 300000,
      balanceTrend: {
        smbcBalanceTrend: [{ date: new Date('2026-06-30T15:00:00.000Z'), balance: 1500000 }],
        otherSavingsBalanceTrend: [{ date: new Date('2026-06-30T15:00:00.000Z'), balance: 800000 }],
        nisaContributionTrend: [
          { date: new Date('2026-06-30T15:00:00.000Z'), accumulated: 300000 },
        ],
        cardUnpaidTrend: [{ date: new Date('2026-06-30T15:00:00.000Z'), unpaidTotal: 42000 }],
      },
    },
    csvConfirmedAt: new Date('2026-07-01T01:00:00.000Z'),
    causingTransactionIds: [newUlid()],
  })
}

export function finalizedReport(input: { targetYearMonth?: YearMonth } = {}): MonthlyReport {
  const base = csvConfirmedReport(input)
  return MonthlyReportSchema.parse({
    kind: 'finalized',
    common: base.common,
    csvConfirmedAt: base.kind === 'csv_confirmed' ? base.csvConfirmedAt : new Date(),
    finalizedAt: new Date('2026-07-03T01:00:00.000Z'),
    expenseReimbursementId: newUlid(),
    expenseReimbursementMatchedAt: new Date('2026-07-02T01:00:00.000Z'),
    unapprovedTransfers: [
      {
        originalBusinessExpenseTransactionId: newUlid(),
        transferTarget: 'personal_honey',
        transferAmount: 1500,
        transferredAt: new Date('2026-07-03T00:30:00.000Z'),
      },
    ],
  })
}

export function smbcAccount(
  input: { ownerUserId?: UserId; currentBalance?: number; isActive?: boolean } = {},
): Account {
  return AccountSchema.parse({
    kind: 'smbc_bank',
    common: {
      accountId: newUlid(),
      ownerUserId: input.ownerUserId ?? HONEY_USER_ID,
      registeredAt: new Date('2026-01-01T00:00:00.000Z'),
      activeness:
        input.isActive === false
          ? {
              kind: 'inactive',
              inactivatedAt: new Date('2026-06-01T00:00:00.000Z'),
              reason: '解約',
            }
          : { kind: 'active' },
    },
    balance: {
      currentBalance: input.currentBalance ?? 1500000,
      initialBalance: 1000000,
      initialBalanceBaselineAt: new Date('2026-01-01T00:00:00.000Z'),
      lastUpdatedAt: new Date('2026-07-01T00:00:00.000Z'),
    },
  })
}

export function cardAccount(input: { ownerUserId?: UserId; unpaidRef?: string } = {}): Account {
  return AccountSchema.parse({
    kind: 'mitsui_sumitomo_card',
    common: {
      accountId: newUlid(),
      ownerUserId: input.ownerUserId ?? HONEY_USER_ID,
      registeredAt: new Date('2026-01-02T00:00:00.000Z'),
      activeness: { kind: 'active' },
    },
    unpaidAggregateRef: input.unpaidRef ?? newUlid(),
  })
}

export function otherSavingsAccount(
  input: {
    ownerUserId?: UserId
    currentBalance?: number
    lastUpdatedAt?: Date
    /** 鮮度根拠の最終更新日時（08d L60）。省略時は残高の最終更新日時と同値 */
    freshnessLastUpdatedAt?: Date
    registeredAt?: Date
    bankName?: string
  } = {},
): Account {
  const lastUpdatedAt = input.lastUpdatedAt ?? new Date('2026-07-01T00:00:00.000Z')
  const freshnessLastUpdatedAt = input.freshnessLastUpdatedAt ?? lastUpdatedAt
  return AccountSchema.parse({
    kind: 'other_savings',
    common: {
      accountId: newUlid(),
      ownerUserId: input.ownerUserId ?? DARLING_USER_ID,
      registeredAt: input.registeredAt ?? new Date('2026-01-03T00:00:00.000Z'),
      activeness: { kind: 'active' },
    },
    bankName: input.bankName ?? 'ゆうちょ銀行',
    balance: {
      currentBalance: input.currentBalance ?? 800000,
      initialBalance: 500000,
      initialBalanceBaselineAt: new Date('2026-01-03T00:00:00.000Z'),
      lastUpdatedAt,
    },
    freshnessSource: { lastUpdatedAt: freshnessLastUpdatedAt },
  })
}

export function nisaAccount(
  input: { ownerUserId?: UserId; currentAccumulated?: number } = {},
): Account {
  return AccountSchema.parse({
    kind: 'nisa',
    common: {
      accountId: newUlid(),
      ownerUserId: input.ownerUserId ?? HONEY_USER_ID,
      registeredAt: new Date('2026-01-04T00:00:00.000Z'),
      activeness: { kind: 'active' },
    },
    brokerageName: { kind: 'sbi' },
    contribution: {
      currentAccumulated: input.currentAccumulated ?? 300000,
      initialAccumulated: 100000,
      initialAccumulatedBaselineAt: new Date('2026-01-04T00:00:00.000Z'),
      lastUpdatedAt: new Date('2026-07-01T00:00:00.000Z'),
    },
  })
}

export function unpaidAggregate(input: {
  accountId: string
  bookedAmounts?: number[]
  withSettledEntry?: boolean
}): MitsuiSumitomoUnpaid {
  const bookedAmounts = input.bookedAmounts ?? [30000, 12000]
  const entries = bookedAmounts.map((amount, i) => ({
    kind: 'booked' as const,
    entryId: newUlid(),
    transactionId: newUlid(),
    bookedAt: new Date(`2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`),
    amount,
  }))
  const settled =
    input.withSettledEntry === true
      ? [
          {
            kind: 'settled' as const,
            entryId: newUlid(),
            transactionId: newUlid(),
            bookedAt: new Date('2026-06-10T00:00:00.000Z'),
            settledAt: new Date('2026-06-26T00:00:00.000Z'),
            amount: 9800,
            settlementNoticeId: `sn-${newUlid()}`,
          },
        ]
      : []
  return MitsuiSumitomoUnpaidSchema.parse({
    unpaidAggregateId: newUlid(),
    accountId: input.accountId,
    currentMonthUnpaidTotal: bookedAmounts.reduce((a, b) => a + b, 0),
    entries: [...entries, ...settled],
    lastSettledAt: input.withSettledEntry === true ? new Date('2026-06-26T00:00:00.000Z') : null,
  })
}

export function balanceHistoryEntry(input: {
  accountId: string
  axis?: BalanceAxis
  balance?: number
  occurredAt?: Date
  sourceEventId?: string
}): BalanceHistoryEntry {
  return BalanceHistoryEntrySchema.parse({
    entryId: newUlid(),
    axis: input.axis ?? 'smbc_balance',
    accountId: input.accountId,
    balance: input.balance ?? 1500000,
    occurredAt: input.occurredAt ?? new Date('2026-05-10T00:00:00.000Z'),
    sourceEventId: input.sourceEventId ?? newUlid(),
  })
}
