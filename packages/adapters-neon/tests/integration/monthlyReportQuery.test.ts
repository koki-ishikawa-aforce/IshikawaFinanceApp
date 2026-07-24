import { describe, it, expect } from 'vitest'
import { NeonMonthlyReportQuery } from '../../src/household-analysis/NeonMonthlyReportQuery'
import { NeonMonthlyReportRepository } from '../../src/household-analysis/NeonMonthlyReportRepository'
import { db } from './setup'
import {
  DARLING_USER_ID,
  HONEY_USER_ID,
  csvConfirmedReport,
  finalizedReport,
  ym,
} from '../helpers/fixtures'
import { stubResolveViewerRole } from '../helpers/stubs'

const repo = new NeonMonthlyReportRepository(db)
const query = new NeonMonthlyReportQuery(db, { resolveViewerRole: stubResolveViewerRole })

describe('NeonMonthlyReportQuery', () => {
  it('csv_confirmed は finalizedAt / unapprovedTransfers が null の View になる', async () => {
    const report = csvConfirmedReport({ targetYearMonth: ym('2026-06') })
    await repo.save(report)
    const view = await query.fetchByMonth(HONEY_USER_ID, ym('2026-06'))
    expect(view?.status).toBe('csv_confirmed')
    // A②: 経費(会社) は本人分のみ businessExpenseTotalSelf に射影、配偶者分は含めない
    const {
      businessExpenseTotalHoney,
      businessExpenseTotalDarling: _businessExpenseTotalDarling,
      ...commonRest
    } = report.common
    expect(view?.common).toEqual({
      ...commonRest,
      businessExpenseTotalSelf: businessExpenseTotalHoney,
    })
    expect(view?.common).not.toHaveProperty('businessExpenseTotalHoney')
    expect(view?.common).not.toHaveProperty('businessExpenseTotalDarling')
    expect(view?.finalizedAt).toBeNull()
    expect(view?.unapprovedTransfers).toBeNull()
  })

  it('A②: 閲覧者の役割に応じて本人の経費(会社)合計のみを返す（配偶者分は漏らさない）', async () => {
    const report = csvConfirmedReport({ targetYearMonth: ym('2026-05') })
    await repo.save(report)
    const honeyView = await query.fetchByMonth(HONEY_USER_ID, ym('2026-05'))
    expect(honeyView?.common.businessExpenseTotalSelf).toBe(report.common.businessExpenseTotalHoney)
    const darlingView = await query.fetchByMonth(DARLING_USER_ID, ym('2026-05'))
    expect(darlingView?.common.businessExpenseTotalSelf).toBe(
      report.common.businessExpenseTotalDarling,
    )
    // 個人合計は「相手には合計のみ可視」のため両者に残る
    expect(darlingView?.common.personalTotalHoney).toBe(report.common.personalTotalHoney)
  })

  it('finalized は finalizedAt を持ち、本人の不認定分振替のみ返す', async () => {
    const report = finalizedReport({ targetYearMonth: ym('2026-06') })
    await repo.save(report)
    if (report.kind !== 'finalized') throw new Error('unreachable')
    const view = await query.fetchById(HONEY_USER_ID, report.common.monthlyReportId)
    expect(view?.status).toBe('finalized')
    expect(view?.finalizedAt).toEqual(report.finalizedAt)
    // fixture の transferTarget は personal_honey → honey 本人には見える
    expect(view?.unapprovedTransfers).toEqual(report.unapprovedTransfers)
  })

  it('#108: 配偶者の不認定分振替は返さない（経費由来データのプライバシー強制）', async () => {
    const report = finalizedReport({ targetYearMonth: ym('2026-04') })
    await repo.save(report)
    if (report.kind !== 'finalized') throw new Error('unreachable')
    // fixture の transferTarget は personal_honey → darling には見えない
    const darlingView = await query.fetchByMonth(DARLING_USER_ID, ym('2026-04'))
    expect(darlingView?.unapprovedTransfers).toEqual([])
  })

  it('#108: 両ロールの不認定分振替が混在する場合、本人分のみフィルタされる', async () => {
    const base = finalizedReport({ targetYearMonth: ym('2026-03') })
    if (base.kind !== 'finalized') throw new Error('unreachable')
    const honeyTransfer = base.unapprovedTransfers[0]
    if (honeyTransfer === undefined) throw new Error('unreachable')
    const darlingTransfer = {
      ...honeyTransfer,
      transferTarget: 'personal_darling' as const,
    }
    const mixed = { ...base, unapprovedTransfers: [honeyTransfer, darlingTransfer] }
    await repo.save(mixed)
    const honeyView = await query.fetchByMonth(HONEY_USER_ID, ym('2026-03'))
    expect(honeyView?.unapprovedTransfers).toEqual([honeyTransfer])
    const darlingView = await query.fetchByMonth(DARLING_USER_ID, ym('2026-03'))
    expect(darlingView?.unapprovedTransfers).toEqual([darlingTransfer])
  })

  it('存在しない月 / ID は null', async () => {
    expect(await query.fetchByMonth(HONEY_USER_ID, ym('2026-01'))).toBeNull()
    const report = csvConfirmedReport()
    expect(await query.fetchById(HONEY_USER_ID, report.common.monthlyReportId)).toBeNull()
  })
})
