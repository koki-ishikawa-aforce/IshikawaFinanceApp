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
import { AccountIdSchema, BalanceHistoryEntryIdSchema, recordBalanceChange } from '@warimaru/domain'
import type { BalanceAxis } from '@warimaru/domain'

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

describe('月次レポートの残高部分を残高変動履歴から凍結する（#398）', () => {
  const ACCOUNT_ID = AccountIdSchema.parse(newUlid())

  /** 対象月（2026-07 JST）の残高変動を 1 件仕込む */
  async function givenBalanceChange(
    t: ReturnType<typeof createTestApp>,
    input: { axis: BalanceAxis; balance: number; occurredAt: Date },
  ) {
    await t.deps.balanceHistoryRepository.append(
      recordBalanceChange({
        entryId: BalanceHistoryEntryIdSchema.parse(newUlid()),
        axis: input.axis,
        accountId: ACCOUNT_ID,
        balance: money(input.balance),
        occurredAt: input.occurredAt,
        sourceEventId: newUlid(),
      }),
    )
  }

  it('対象月の 4 軸の点と NISA 積立累計がレポートに入る（LINE の残高 3 行の材料）', async () => {
    const t = createTestApp()
    await seedUsers(t)
    await givenBalanceChange(t, {
      axis: 'smbc_balance',
      balance: 1500000,
      occurredAt: new Date('2026-07-10T00:00:00Z'),
    })
    await givenBalanceChange(t, {
      axis: 'other_savings_balance',
      balance: 800000,
      occurredAt: new Date('2026-07-11T00:00:00Z'),
    })
    await givenBalanceChange(t, {
      axis: 'card_unpaid',
      balance: 42000,
      occurredAt: new Date('2026-07-12T00:00:00Z'),
    })
    await givenBalanceChange(t, {
      axis: 'nisa_contribution',
      balance: 350000,
      occurredAt: new Date('2026-07-13T00:00:00Z'),
    })

    await t.deps.eventBus.publish(makeCsvImportCompleted())

    const report = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)
    const trend = report!.common.balanceTrend
    expect(trend.smbcBalanceTrend.map(p => p.balance)).toEqual([1500000])
    expect(trend.otherSavingsBalanceTrend.map(p => p.balance)).toEqual([800000])
    expect(trend.cardUnpaidTrend.map(p => p.unpaidTotal)).toEqual([42000])
    expect(trend.nisaContributionTrend.map(p => p.accumulated)).toEqual([350000])
    expect(report!.common.nisaContributionAccumulated).toBe(350000)
  })

  it('対象月の外で起きた変動は入らない（凍結するのはその月の値）', async () => {
    const t = createTestApp()
    await seedUsers(t)
    await givenBalanceChange(t, {
      axis: 'smbc_balance',
      balance: 111,
      occurredAt: new Date('2026-06-30T14:00:00Z'), // 2026-06-30 23:00 JST
    })
    await givenBalanceChange(t, {
      axis: 'smbc_balance',
      balance: 222,
      occurredAt: new Date('2026-07-31T15:00:00Z'), // 2026-08-01 00:00 JST
    })

    await t.deps.eventBus.publish(makeCsvImportCompleted())

    const report = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)
    expect(report!.common.balanceTrend.smbcBalanceTrend).toEqual([])
  })

  it('当月に積立が無くても、積立累計は前月までの値を引き継ぐ（0 に落とさない）', async () => {
    const t = createTestApp()
    await seedUsers(t)
    await givenBalanceChange(t, {
      axis: 'nisa_contribution',
      balance: 300000,
      occurredAt: new Date('2026-05-10T00:00:00Z'),
    })

    await t.deps.eventBus.publish(makeCsvImportCompleted())

    const report = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)
    // 当月の点は無いので線は飛ぶが、累計そのものは前月から引き継ぐ
    expect(report!.common.balanceTrend.nisaContributionTrend).toEqual([])
    expect(report!.common.nisaContributionAccumulated).toBe(300000)
  })

  it('履歴が 1 件も無ければ残高部分は空のまま（0 円の残高と取り違えない）', async () => {
    const t = createTestApp()
    await seedUsers(t)

    await t.deps.eventBus.publish(makeCsvImportCompleted())

    const report = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)
    expect(report!.common.balanceTrend.smbcBalanceTrend).toEqual([])
    expect(report!.common.nisaContributionAccumulated).toBe(0)
  })

  it('再集計では残高部分も履歴から入れ直す（取込のたびに最新の点まで載る）', async () => {
    const t = createTestApp()
    await seedUsers(t)
    await givenBalanceChange(t, {
      axis: 'smbc_balance',
      balance: 1500000,
      occurredAt: new Date('2026-07-10T00:00:00Z'),
    })
    await t.deps.eventBus.publish(makeCsvImportCompleted())
    expect(
      (await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH))!.common.balanceTrend
        .smbcBalanceTrend,
    ).toHaveLength(1)

    await givenBalanceChange(t, {
      axis: 'smbc_balance',
      balance: 1400000,
      occurredAt: new Date('2026-07-20T00:00:00Z'),
    })
    await t.deps.eventBus.publish(makeCsvImportCompleted())

    const refreshed = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)
    expect(refreshed!.common.balanceTrend.smbcBalanceTrend.map(p => p.balance)).toEqual([
      1500000, 1400000,
    ])
  })
})
