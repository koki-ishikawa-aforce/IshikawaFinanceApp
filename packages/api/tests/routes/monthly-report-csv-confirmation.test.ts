import { describe, it, expect } from 'vitest'
import {
  CsvImportCompletedSchema,
  MonthlyReportIdSchema,
  TransactionIdSchema,
  UserIdSchema,
  YearMonthSchema,
  CategoryIdSchema,
  ExpenseReimbursementIdSchema,
  confirmCsv,
  createClassifiedTransaction,
  finalize,
  money,
  registerAppUser,
} from '@warimaru/domain'
import type {
  CsvImportCompleted,
  ClassifiedTransaction,
  MonthlyReportCsvConfirmed,
  YearMonth,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-postgres'
import { createTestApp } from '../helpers/test-app.js'
import { domainEventBase } from '../../src/event-handlers/event-base.js'

const HONEY_USER_ID = UserIdSchema.parse('user-honey-test')
const DARLING_USER_ID = UserIdSchema.parse('user-darling-test')
const TARGET_MONTH: YearMonth = YearMonthSchema.parse('2026-07')

function makeCsvImportCompleted(
  targetYearMonths: YearMonth[] = [TARGET_MONTH],
): CsvImportCompleted {
  return CsvImportCompletedSchema.parse({
    ...domainEventBase(),
    type: 'CsvImportCompleted',
    importJobId: newUlid(),
    userId: HONEY_USER_ID,
    summary: {
      newCount: 3,
      autoClassifiedEstimateCount: 2,
      unclassifiedEstimateCount: 1,
      duplicateExcludedCount: 0,
    },
    targetYearMonths,
  })
}

function makeClassifiedTransaction(
  ownerUserId: string,
  month: string,
  ownerRole: 'honey' | 'darling',
  opts: {
    expenseClass?: 'household' | 'personal_honey' | 'personal_darling'
    amount?: number
    categoryId?: string
  } = {},
): ClassifiedTransaction {
  const expenseClass = opts.expenseClass ?? 'household'
  const categoryId = CategoryIdSchema.parse(opts.categoryId ?? newUlid())
  return createClassifiedTransaction(
    {
      transactionId: TransactionIdSchema.parse(newUlid()),
      ownerUserId: UserIdSchema.parse(ownerUserId),
      merchantName: 'テスト店舗',
      amount: money(opts.amount ?? 1000),
      occurredAt: new Date(`${month}-15T10:00:00+09:00`),
      importSource: {
        kind: 'manual',
        enteredAt: new Date(`${month}-15T10:00:00+09:00`),
        enteredByUserId: UserIdSchema.parse(ownerUserId),
      },
    },
    {
      categoryId,
      expenseClass,
      expenseTypeRef: { kind: 'non_business' },
      basis: {
        kind: 'user_manual',
        modifiedByUserId: UserIdSchema.parse(ownerUserId),
        modifiedAt: new Date(`${month}-15T10:00:00+09:00`),
      },
    },
    ownerRole,
  )
}

async function seedUsers(t: ReturnType<typeof createTestApp>) {
  const honey = registerAppUser(HONEY_USER_ID, 'honey', undefined, new Date('2026-01-01'))
  const darling = registerAppUser(DARLING_USER_ID, 'darling', undefined, new Date('2026-01-01'))
  await t.deps.appUserRepository.save(honey)
  await t.deps.appUserRepository.save(darling)
}

describe('CSV取込完了 → 月次レポートCSV確定（イベントチェーン2 #69）', () => {
  it('正常系: CsvImportCompleted で新規の CSV確定レポートが作成され MonthlyReportCsvConfirmed が発火する', async () => {
    const t = createTestApp()
    await seedUsers(t)

    const csvConfirmedLog: MonthlyReportCsvConfirmed[] = []
    t.deps.eventBus.subscribe<MonthlyReportCsvConfirmed>('MonthlyReportCsvConfirmed', e => {
      csvConfirmedLog.push(e)
    })

    const tx1 = makeClassifiedTransaction(HONEY_USER_ID, '2026-07', 'honey', {
      expenseClass: 'personal_honey',
      amount: 3000,
    })
    const tx2 = makeClassifiedTransaction(DARLING_USER_ID, '2026-07', 'darling', {
      expenseClass: 'personal_darling',
      amount: 2000,
    })
    await t.deps.transactionRepository.save(tx1)
    await t.deps.transactionRepository.save(tx2)

    const event = makeCsvImportCompleted()
    await t.deps.eventBus.publish(event)

    const report = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)
    expect(report).not.toBeNull()
    expect(report!.kind).toBe('csv_confirmed')
    expect(report!.common.personalTotalHoney).toBe(3000)
    expect(report!.common.personalTotalDarling).toBe(2000)

    expect(csvConfirmedLog).toHaveLength(1)
    expect(csvConfirmedLog[0]!.monthlyReportId).toBe(report!.common.monthlyReportId)
  })

  it('冪等: 再配信で既存の CSV確定レポートが再集計（上書き）される', async () => {
    const t = createTestApp()
    await seedUsers(t)

    const tx1 = makeClassifiedTransaction(HONEY_USER_ID, '2026-07', 'honey', {
      expenseClass: 'personal_honey',
      amount: 3000,
    })
    await t.deps.transactionRepository.save(tx1)
    await t.deps.eventBus.publish(makeCsvImportCompleted())

    const first = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)
    expect(first!.common.personalTotalHoney).toBe(3000)

    const tx2 = makeClassifiedTransaction(HONEY_USER_ID, '2026-07', 'honey', {
      expenseClass: 'personal_honey',
      amount: 5000,
    })
    await t.deps.transactionRepository.save(tx2)
    await t.deps.eventBus.publish(makeCsvImportCompleted())

    const refreshed = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)
    expect(refreshed!.kind).toBe('csv_confirmed')
    expect(refreshed!.common.personalTotalHoney).toBe(8000)
    expect(refreshed!.common.monthlyReportId).toBe(first!.common.monthlyReportId)
  })

  it('finalized レポートは上書きしない（単方向遷移の維持）— イベントも発火しない', async () => {
    const t = createTestApp()
    await seedUsers(t)

    const csvConfirmedLog: MonthlyReportCsvConfirmed[] = []
    t.deps.eventBus.subscribe<MonthlyReportCsvConfirmed>('MonthlyReportCsvConfirmed', e => {
      csvConfirmedLog.push(e)
    })

    const csvReport = confirmCsv(
      {
        monthlyReportId: MonthlyReportIdSchema.parse(newUlid()),
        targetYearMonth: TARGET_MONTH,
        householdCategoryTotals: [],
        personalTotalHoney: money(1000),
        personalTotalDarling: money(0),
        businessExpenseTotalHoney: money(0),
        businessExpenseTotalDarling: money(0),
        nisaContributionAccumulated: money(0),
        balanceTrend: {
          smbcBalanceTrend: [],
          otherSavingsBalanceTrend: [],
          nisaContributionTrend: [],
          cardUnpaidTrend: [],
        },
      },
      [],
      new Date('2026-08-01T10:00:00Z'),
    )
    const finalizedReport = finalize(
      csvReport,
      ExpenseReimbursementIdSchema.parse(newUlid()),
      new Date('2026-08-02T09:00:00Z'),
      [],
      new Date('2026-08-02T09:00:00Z'),
    )
    await t.deps.monthlyReportRepository.save(finalizedReport)

    const tx = makeClassifiedTransaction(HONEY_USER_ID, '2026-07', 'honey', {
      expenseClass: 'personal_honey',
      amount: 9999,
    })
    await t.deps.transactionRepository.save(tx)
    await t.deps.eventBus.publish(makeCsvImportCompleted())

    const saved = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)
    expect(saved!.kind).toBe('finalized')
    expect(saved!.common.personalTotalHoney).toBe(1000)
    expect(csvConfirmedLog).toHaveLength(0)
  })

  it('両メンバーの取引が集計される', async () => {
    const t = createTestApp()
    await seedUsers(t)

    const catId = CategoryIdSchema.parse(newUlid())
    const tx1 = makeClassifiedTransaction(HONEY_USER_ID, '2026-07', 'honey', {
      expenseClass: 'household',
      amount: 4000,
      categoryId: catId,
    })
    const tx2 = makeClassifiedTransaction(DARLING_USER_ID, '2026-07', 'darling', {
      expenseClass: 'household',
      amount: 6000,
      categoryId: catId,
    })
    await t.deps.transactionRepository.save(tx1)
    await t.deps.transactionRepository.save(tx2)
    await t.deps.eventBus.publish(makeCsvImportCompleted())

    const report = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)
    expect(report).not.toBeNull()
    const householdTotal = report!.common.householdCategoryTotals.find(c => c.categoryId === catId)
    expect(householdTotal?.total).toBe(10000)
  })
})
