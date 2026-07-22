import { describe, it, expect } from 'vitest'
import {
  CommonMonthlyReportAttrsSchema,
  ExpenseReimbursementIdSchema,
  MonthlyExpenseCycleSchema,
  MonthlyReportIdSchema,
  TransactionIdSchema,
  YearMonthSchema,
  confirmCsv,
  finalize,
} from '@warimaru/domain'
import type {
  CommonMonthlyReportAttrs,
  CsvConfirmedReport,
  MonthlyExpenseCycle,
  MonthlyReportFinalized,
  YearMonth,
} from '@warimaru/domain'
import { newUlid } from '@warimaru/adapters-neon'
import { createApp } from '../../src/app.js'
import { createDeps } from '../../src/composition-root.js'
import type { TestApp } from '../helpers/test-app.js'
import { createTestApp, request, VIEWER_ID } from '../helpers/test-app.js'

const TARGET_MONTH: YearMonth = YearMonthSchema.parse('2026-07')

function csvConfirmedReport(targetYearMonth: YearMonth): CsvConfirmedReport {
  const common: CommonMonthlyReportAttrs = CommonMonthlyReportAttrsSchema.parse({
    monthlyReportId: MonthlyReportIdSchema.parse(newUlid()),
    targetYearMonth,
    householdCategoryTotals: [],
    personalTotalHoney: 12000,
    personalTotalDarling: 8000,
    businessExpenseTotalHoney: 5000,
    businessExpenseTotalDarling: 0,
    nisaContributionAccumulated: 0,
    balanceTrend: {
      smbcBalanceTrend: [],
      otherSavingsBalanceTrend: [],
      nisaContributionTrend: [],
      cardUnpaidTrend: [],
    },
  })
  return confirmCsv(common, [], new Date('2026-08-01T10:00:00Z'))
}

function subscribeReportFinalized(t: TestApp): MonthlyReportFinalized[] {
  const log: MonthlyReportFinalized[] = []
  t.deps.eventBus.subscribe<MonthlyReportFinalized>('MonthlyReportFinalized', e => {
    log.push(e)
  })
  return log
}

async function seedCsvConfirmedCycle(t: TestApp): Promise<string> {
  const createRes = await request(t.app, 'POST', '/api/expense-settlement/cycles', {
    body: { targetMonth: TARGET_MONTH },
  })
  expect(createRes.status).toBe(201)
  const cycleId = ((await createRes.json()) as { common: { monthlyExpenseCycleId: string } }).common
    .monthlyExpenseCycleId
  const confirmRes = await request(
    t.app,
    'PUT',
    `/api/expense-settlement/cycles/${cycleId}/confirm-csv`,
  )
  expect(confirmRes.status).toBe(200)
  return cycleId
}

async function seedDeposit(t: TestApp): Promise<string> {
  const res = await request(t.app, 'POST', '/api/expense-settlement/deposits', {
    body: { depositAmount: 5000 },
  })
  expect(res.status).toBe(201)
  return ((await res.json()) as { common: { expenseReimbursementId: string } }).common
    .expenseReimbursementId
}

/**
 * 経費合計 total 円の CSV確定サイクルをリポジトリ直挿しで用意する（経費マーキングは別スライス）。
 * 不認定分振替を伴う finalize を検証するため、入金 5000 円との差額が実在する状態を作る。
 */
async function seedCsvConfirmedCycleWithTotal(t: TestApp, total: number): Promise<string> {
  const cycleId = newUlid()
  const cycle: MonthlyExpenseCycle = MonthlyExpenseCycleSchema.parse({
    kind: 'csv_confirmed',
    common: {
      monthlyExpenseCycleId: cycleId,
      userId: VIEWER_ID,
      targetYearMonth: TARGET_MONTH,
      cycleStartedAt: new Date('2026-07-01T00:00:00Z'),
      accumulations: [
        {
          kind: 'capped',
          accumulationId: newUlid(),
          expenseTypeId: newUlid(),
          userId: VIEWER_ID,
          monthlyCap: total + 100000,
          currentTotal: total,
          capReached: { kind: 'not_reached' },
          transactionRefs: [
            {
              transactionId: newUlid(),
              occurredAt: new Date('2026-07-10T00:00:00Z'),
              amount: total,
              allocation: { kind: 'full' },
            },
          ],
        },
      ],
      childTransactionRefs: [],
    },
    csvConfirmedAt: new Date('2026-07-20T00:00:00Z'),
  })
  await t.deps.monthlyExpenseCycleRepository.save(cycle)
  return cycleId
}

async function finalizeCycleViaApi(
  t: TestApp,
  cycleId: string,
  depositId: string,
  unapprovedTransfers?: unknown[],
): Promise<Response> {
  return request(t.app, 'PUT', `/api/expense-settlement/cycles/${cycleId}/finalize`, {
    body: {
      expenseReimbursementId: depositId,
      ...(unapprovedTransfers !== undefined ? { unapprovedTransfers } : {}),
    },
  })
}

describe('サイクル最終確定 → 月次レポート最終確定（#43）', () => {
  it('正常系: サイクル finalize で対象月の CSV確定レポートが最終確定に昇格する', async () => {
    const t = createTestApp()
    const log = subscribeReportFinalized(t)
    const report = csvConfirmedReport(TARGET_MONTH)
    await t.deps.monthlyReportRepository.save(report)

    // 経費合計 8000 に対し入金 5000 → 不認定分 3000。振替 3000 が差額と一致する
    const cycleId = await seedCsvConfirmedCycleWithTotal(t, 8000)
    const depositId = await seedDeposit(t)
    const transfer = {
      originalBusinessExpenseTransactionId: TransactionIdSchema.parse(newUlid()),
      transferTarget: 'personal_honey',
      transferAmount: 3000,
    }
    const res = await finalizeCycleViaApi(t, cycleId, depositId, [transfer])
    expect(res.status).toBe(200)

    const saved = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)
    expect(saved?.kind).toBe('finalized')
    if (saved?.kind !== 'finalized') return
    expect(saved.common.monthlyReportId).toBe(report.common.monthlyReportId)
    expect(saved.expenseReimbursementId).toBe(depositId)
    // 不認定分振替リストが確定済みサイクルからレポートへ引き渡される
    expect(saved.unapprovedTransfers).toHaveLength(1)
    expect(saved.unapprovedTransfers[0]?.originalBusinessExpenseTransactionId).toBe(
      transfer.originalBusinessExpenseTransactionId,
    )
    expect(saved.unapprovedTransfers[0]?.transferAmount).toBe(3000)
    // CSV確定日時は保持し、最終確定日時はサイクルの確定日時と一致する
    expect(saved.csvConfirmedAt).toEqual(report.csvConfirmedAt)
    const cycle = await t.deps.monthlyExpenseCycleRepository.findById(cycleId as never)
    expect(cycle?.kind).toBe('finalized')
    if (cycle?.kind === 'finalized') expect(saved.finalizedAt).toEqual(cycle.finalizedAt)
    // 月次レポート最終確定イベントが発火する（08c §2）
    expect(log).toHaveLength(1)
    expect(log[0]?.monthlyReportId).toBe(report.common.monthlyReportId)
    expect(log[0]?.expenseReimbursementId).toBe(depositId)
  })

  it('対象月のレポートが未作成なら昇格をスキップし、finalize 自体は成功する', async () => {
    const t = createTestApp()
    const log = subscribeReportFinalized(t)
    const cycleId = await seedCsvConfirmedCycle(t)
    const depositId = await seedDeposit(t)
    const res = await finalizeCycleViaApi(t, cycleId, depositId)
    expect(res.status).toBe(200)
    expect(await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)).toBeNull()
    expect(log).toHaveLength(0)
  })

  it('冪等: finalize リプレイ（イベント再配信）でも二重適用せず、イベントも再発火しない', async () => {
    const t = createTestApp()
    const log = subscribeReportFinalized(t)
    await t.deps.monthlyReportRepository.save(csvConfirmedReport(TARGET_MONTH))
    const cycleId = await seedCsvConfirmedCycle(t)
    const depositId = await seedDeposit(t)

    const first = await finalizeCycleViaApi(t, cycleId, depositId)
    expect(first.status).toBe(200)
    const afterFirst = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)

    const replay = await finalizeCycleViaApi(t, cycleId, depositId)
    expect(replay.status).toBe(200)
    const afterReplay = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)
    expect(afterReplay).toEqual(afterFirst)
    expect(log).toHaveLength(1)
  })

  it('別の精算入金で最終確定済みのレポートは上書きしない（finalize 自体は成功する）', async () => {
    const t = createTestApp()
    const log = subscribeReportFinalized(t)
    const otherReimbursementId = ExpenseReimbursementIdSchema.parse(newUlid())
    const alreadyFinalized = finalize(
      csvConfirmedReport(TARGET_MONTH),
      otherReimbursementId,
      new Date('2026-08-02T09:00:00Z'),
      [],
      new Date('2026-08-02T09:00:00Z'),
    )
    await t.deps.monthlyReportRepository.save(alreadyFinalized)

    const cycleId = await seedCsvConfirmedCycle(t)
    const depositId = await seedDeposit(t)
    const res = await finalizeCycleViaApi(t, cycleId, depositId)
    expect(res.status).toBe(200)

    const saved = await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH)
    expect(saved).toEqual(alreadyFinalized)
    expect(log).toHaveLength(0)
  })

  it('復旧パス: 突合のみ完了する再実行でもレポートが最終確定に昇格する', async () => {
    // 入金 save が 1 回目だけ失敗する（= サイクル確定と入金突合の間のクラッシュを再現）
    const deps = createDeps({})
    const original = deps.expenseReimbursementDepositRepository
    let failNextMatchedSave = true
    deps.expenseReimbursementDepositRepository = {
      ...original,
      async save(deposit) {
        if (deposit.kind === 'matched' && failNextMatchedSave) {
          failNextMatchedSave = false
          throw new Error('injected save failure')
        }
        return original.save(deposit)
      },
    }
    const t: TestApp = { app: createApp(deps), deps }
    const log = subscribeReportFinalized(t)
    await t.deps.monthlyReportRepository.save(csvConfirmedReport(TARGET_MONTH))
    const cycleId = await seedCsvConfirmedCycle(t)
    const depositId = await seedDeposit(t)

    const crashed = await finalizeCycleViaApi(t, cycleId, depositId)
    expect(crashed.status).toBe(500)
    expect((await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH))?.kind).toBe(
      'csv_confirmed',
    )

    const retry = await finalizeCycleViaApi(t, cycleId, depositId)
    expect(retry.status).toBe(200)
    expect((await t.deps.monthlyReportRepository.findByMonth(TARGET_MONTH))?.kind).toBe('finalized')
    expect(log).toHaveLength(1)
  })
})
